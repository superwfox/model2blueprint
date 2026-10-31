import {
  ACESFilmicToneMapping, Box3, BufferAttribute, BufferGeometry, Color, DirectionalLight, GridHelper,
  Group, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera, Plane, Raycaster, Scene, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { disposeModel } from '../glb.ts';
import { FallingAnimation } from './falling-view.ts';
import { BlockTextures } from './texture-material.ts';
import { KeyboardNavigation } from './keyboard-navigation.ts';
import { FirstPersonNavigation } from './first-person.ts';
import { OrbitPinchZoom } from './orbit-pinch.ts';
import { WalkingCollision } from '../../core/walking.ts';
import type { MovementMode, NavigationProfiles, NavigationState, SpeedAxis } from './navigation-types.ts';
import type { FallingData, GridSize, ModelData, SurfaceData, Vec3, VoxelResult } from '../../core/types.ts';
import type { CameraState } from '../history/types.ts';

export class Viewer {
  private scene = new Scene();
  private camera = new PerspectiveCamera(40, 1, 0.01, 10000);
  private renderer: WebGLRenderer;
  private controls: OrbitControls;
  private navigation: KeyboardNavigation;
  private firstPerson: FirstPersonNavigation;
  private orbitPinch: OrbitPinchZoom;
  private collision = new WalkingCollision();
  private viewListeners = new Set<() => void>();
  private navigationListeners = new Set<(state: NavigationState) => void>();
  private activityListeners = new Set<() => void>();
  private noticeListeners = new Set<(message: string, failed: boolean) => void>();
  private lastActivity = -Infinity;
  private selecting = false;
  private navigationEnabled = false;
  private raycaster = new Raycaster();
  private ground = new Plane(new Vector3(0, 1, 0), 0);
  private original = new Group();
  private converted = new Group();
  private grid: GridHelper | null = null;
  private size: GridSize | null = null;
  private mode: 'original' | 'result' = 'original';
  private observer: ResizeObserver;
  private frame = 0;
  private dropStart?: number;
  private dropElapsed = 0;
  private dropReady = false;
  private falling?: FallingAnimation;
  private steady?: Mesh<BufferGeometry, MeshStandardMaterial>;
  private textures: BlockTextures;
  private disposed = false;
  private updateZoomSpeed = (event: WheelEvent | PointerEvent): void => { this.controls.zoomSpeed = event.shiftKey ? 1 : 3; };

  constructor(container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false });
    this.textures = new BlockTextures();
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.setClearColor('#000000');
    container.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', '建筑三维预览，点击后用 WASD 移动、上下方向键升降；拖动旋转、滚轮缩放，Shift 精细缩放');
    this.renderer.domElement.setAttribute('aria-keyshortcuts', 'W A S D ArrowUp ArrowDown');
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.zoomSpeed = 3;
    this.renderer.domElement.addEventListener('wheel', this.updateZoomSpeed, { capture: true, passive: true });
    this.renderer.domElement.addEventListener('pointerdown', this.updateZoomSpeed, true);
    this.renderer.domElement.addEventListener('pointermove', this.updateZoomSpeed, true);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.navigation = new KeyboardNavigation(this.camera, this.renderer.domElement, kind => this.firstPerson.action(kind));
    this.firstPerson = new FirstPersonNavigation(this.camera, this.controls, this.renderer.domElement, this.collision,
      this.navigationChanged, this.navigationMoved, message => this.notice(message, true));
    this.orbitPinch = new OrbitPinchZoom(this.camera, this.controls, this.renderer.domElement,
      () => this.navigationEnabled && !this.selecting && !this.firstPerson.active);
    this.controls.addEventListener('change', this.notifyView);
    this.renderer.domElement.addEventListener('click', this.selectLanding, true);
    window.addEventListener('keydown', this.cancelSelectionKey, true);
    this.scene.add(this.original, this.converted);
    this.scene.add(new HemisphereLight('#dce9f4', '#66725e', 2.3));
    const key = new DirectionalLight('#fff2d8', 3.2); key.position.set(200, 400, 180); this.scene.add(key);
    const fill = new DirectionalLight('#9cbfe2', 1.8); fill.position.set(-180, 120, -140); this.scene.add(fill);
    this.observer = new ResizeObserver(() => {
      const width = container.clientWidth, height = container.clientHeight;
      this.renderer.setSize(width, height); this.camera.aspect = width / Math.max(1, height); this.camera.updateProjectionMatrix();
    });
    this.observer.observe(container);
    let previous = performance.now();
    const tick = () => {
      this.frame = requestAnimationFrame(tick);
      const now = performance.now(), delta = Math.min(0.05, Math.max(0, (now - previous) / 1000)); previous = now;
      if (this.falling && this.dropReady) {
        const now = performance.now(), dt = Math.min(0.05, (now - (this.dropStart ?? now)) / 1000);
        this.dropStart = now;
        // Count visible frames so a slow first render cannot consume the whole reveal.
        if (!document.hidden && this.mode === 'result') this.dropElapsed += dt;
        if (this.falling.update(this.dropElapsed)) {
          this.converted.remove(this.falling.mesh); this.falling.dispose(); this.falling = undefined;
          if (this.steady) this.steady.visible = true;
        }
      }
      this.orbitPinch.update(delta);
      if (!this.firstPerson.active) this.controls.update();
      const offset = this.navigation.update(delta);
      if (this.firstPerson.active && this.navigation.active) {
        this.firstPerson.update(delta, offset, this.navigation.pressed('Space'), this.navigation.pressed('ArrowUp'),
          this.navigation.pressed('ArrowDown'), this.navigation.speeds.vertical);
      } else if (!this.firstPerson.active && offset.lengthSq()) {
        this.camera.position.add(offset); this.controls.target.add(offset); this.navigationMoved();
      }
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  setModel(model: ModelData, size: GridSize, scene?: import('three').Object3D): void {
    this.cancelSelection(); this.firstPerson.exit(); this.collision.setWorld();
    this.clearOriginal(); this.clearResult();
    if (scene) this.original.add(scene);
    this.resizeModel(model, size);
    this.setMode('original');
  }

  setOriginalPreview(scene: import('three').Object3D): void { this.clearOriginal(); this.original.add(scene); }

  getCameraState(): CameraState {
    return { position: this.camera.position.toArray(), target: this.controls.target.toArray(),
      near: this.camera.near, far: this.camera.far, maxDistance: this.controls.maxDistance };
  }
  restoreCamera(state: CameraState): void {
    this.orbitPinch.reset();
    this.cancelSelection(); this.firstPerson.exit();
    this.navigation.reset();
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false; this.controls.update(); this.controls.enableDamping = damping;
    this.camera.position.fromArray(state.position); this.controls.target.fromArray(state.target);
    this.camera.near = state.near; this.camera.far = state.far; this.controls.maxDistance = state.maxDistance;
    this.camera.updateProjectionMatrix(); this.controls.update();
  }
  onViewChanged(listener: () => void): () => void {
    this.viewListeners.add(listener); return () => this.viewListeners.delete(listener);
  }
  private notifyView = (): void => { if (!this.disposed) for (const listener of this.viewListeners) listener(); };
  private navigationMoved = (): void => {
    this.notifyView();
    if (this.disposed || performance.now() - this.lastActivity < 100) return;
    this.lastActivity = performance.now(); for (const listener of this.activityListeners) listener();
  };
  private navigationChanged = (): void => {
    this.navigation.setFirstPerson(this.firstPerson.active);
    this.navigation.setFlying(this.firstPerson.active && this.firstPerson.flying);
    this.renderer.domElement.setAttribute('aria-label', this.firstPerson.active
      ? '第一人称建筑预览，WASD 水平移动，Space 跳跃，双击 Space 切换飞行，上下方向键飞行升降，滚轮调整视野，Shift 精细调整，Esc 返回轨道视图'
      : '建筑三维预览，点击后用 WASD 移动、上下方向键升降；拖动旋转、滚轮缩放，Shift 精细缩放');
    if (this.firstPerson.active) this.notice('');
    if (!this.disposed) for (const listener of this.navigationListeners) listener(this.getNavigationState());
  };
  private notice(message: string, failed = false): void {
    if (!this.disposed) for (const listener of this.noticeListeners) listener(message, failed);
  }
  getNavigationState(): NavigationState {
    return { ...this.navigation.speeds, profiles: this.navigation.getProfiles(), firstPerson: this.firstPerson.active, flying: this.firstPerson.flying, selecting: this.selecting };
  }
  onNavigation(listener: (state: NavigationState) => void, activity: () => void, notice: (message: string, failed: boolean) => void): () => void {
    this.navigationListeners.add(listener); this.activityListeners.add(activity); this.noticeListeners.add(notice); listener(this.getNavigationState());
    return () => { this.navigationListeners.delete(listener); this.activityListeners.delete(activity); this.noticeListeners.delete(notice); };
  }
  setNavigationSpeed(mode: MovementMode, axis: SpeedAxis, speed: number): void {
    if (!Number.isFinite(speed) || speed <= 0) return;
    this.navigation.setSpeed(mode, axis, speed); this.navigationChanged(); this.notifyView();
  }
  setNavigationProfiles(profiles: NavigationProfiles): void {
    const values = [profiles.walking.horizontal, profiles.walking.vertical, profiles.flying.horizontal, profiles.flying.vertical];
    if (!values.every(value => Number.isFinite(value) && value > 0)) return;
    this.navigation.setProfiles(profiles); this.navigationChanged(); this.notifyView();
  }
  setVoxels(result: VoxelResult): void { this.collision.setWorld(result); }
  private pickSurface(event: MouseEvent): Vec3 | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(pointer, this.camera); this.raycaster.far = this.camera.far;
    const object = this.mode === 'original' ? this.original : this.steady;
    object?.updateWorldMatrix(true, true);
    const hit = object ? this.raycaster.intersectObject(object, true)[0] : undefined;
    let ground = this.raycaster.ray.intersectPlane(this.ground, new Vector3());
    // Only the visible grid is a selectable ground surface; black empty space is not a hidden plane.
    if (ground && this.size) {
      const halfSpan = Math.max(this.size.width, this.size.length) * 1.25 / 2;
      if (Math.abs(ground.x - this.size.width / 2) > halfSpan || Math.abs(ground.z - this.size.length / 2) > halfSpan) ground = null;
    }
    const distance = ground?.distanceTo(this.raycaster.ray.origin) ?? Infinity;
    if (hit && hit.distance <= distance) return hit.point.toArray();
    if (ground && distance <= this.camera.far) return ground.toArray();
  }
  private selectLanding = (event: MouseEvent): void => {
    if (!this.selecting || event.button !== 0) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const point = this.pickSurface(event);
    if (!point) { this.notice('未选中建筑或地面，请继续点击选择落点；Esc 取消。'); return; }
    this.cancelSelection(); this.renderer.domElement.focus({ preventScroll: true }); this.firstPerson.enter(point);
  };
  private cancelSelectionKey = (event: KeyboardEvent): void => {
    if (this.selecting && event.code === 'Escape') { event.preventDefault(); event.stopPropagation(); this.cancelSelection(); }
  };
  private cancelSelection(): void {
    if (!this.selecting) return;
    this.selecting = false; this.controls.enabled = true; this.renderer.domElement.style.cursor = '';
    this.navigation.setEnabled(this.navigationEnabled); this.navigationChanged(); this.notice('');
  }
  toggleFirstPerson(): void {
    this.orbitPinch.reset();
    if (this.firstPerson.active) { this.firstPerson.exit(); return; }
    if (this.selecting) { this.cancelSelection(); return; }
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false; this.controls.update(); this.controls.enableDamping = damping;
    this.selecting = true; this.controls.enabled = false; this.navigation.setEnabled(false);
    this.renderer.domElement.style.cursor = 'crosshair'; this.navigationChanged(); this.navigationMoved();
    this.notice('点击建筑或地面选择落点，Esc 取消。');
  }

  resizeModel(model: ModelData, size: GridSize): void {
    this.size = size;
    this.original.scale.setScalar(size.scale);
    this.original.position.set(...model.min.map(v => -v * size.scale) as [number, number, number]);
    if (this.grid) { this.scene.remove(this.grid); this.grid.geometry.dispose(); (this.grid.material as import('three').Material).dispose(); }
    const span = Math.max(size.width, size.length);
    this.grid = new GridHelper(span * 1.25, 20, '#655f51', '#262626');
    this.grid.position.set(size.width / 2, -0.04, size.length / 2); this.scene.add(this.grid);
    this.fit();
  }

  setResult(surface: SurfaceData, falling?: FallingData): void {
    this.clearResult();
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(surface.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(surface.normals, 3));
    geometry.setAttribute('color', new BufferAttribute(surface.colors, 3));
    if (surface.textures) geometry.setAttribute('aTexture', new BufferAttribute(surface.textures, 3));
    geometry.computeBoundingSphere();
    const material = surface.textures ? this.textures.material() : new MeshStandardMaterial({ color: new Color('white'), vertexColors: true, roughness: 0.92, metalness: 0 });
    this.steady = new Mesh(geometry, material); this.converted.add(this.steady);
    if (falling && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.falling = new FallingAnimation(falling, this.size?.height ?? 1, falling.textures ? this.textures.material(true) : undefined);
      this.steady.visible = false; this.converted.add(this.falling.mesh);
    }
    this.setMode('result');
  }

  startResultAnimation(): void { this.dropReady = true; }
  setNavigationEnabled(value: boolean): void {
    if (!value) this.orbitPinch.reset();
    this.navigationEnabled = value; if (!value) this.cancelSelection();
    this.navigation.setEnabled(value && !this.selecting); this.firstPerson.setEnabled(value);
  }

  setMode(mode: 'original' | 'result'): void {
    this.mode = mode; this.original.visible = mode === 'original'; this.converted.visible = mode === 'result';
  }

  fit(): void {
    if (!this.size) return;
    this.orbitPinch.reset();
    this.cancelSelection(); this.firstPerson.exit();
    this.navigation.reset();
    const { width, height, length } = this.size;
    const center = new Vector3(width / 2, height / 2, length / 2);
    const radius = new Box3(new Vector3(), new Vector3(width, height, length)).getSize(new Vector3()).length() / 2;
    const fov = Math.min(this.camera.fov * Math.PI / 180, 2 * Math.atan(Math.tan(this.camera.fov * Math.PI / 360) * this.camera.aspect));
    const distance = radius / Math.sin(fov / 2) * 1.08;
    this.camera.position.copy(center).add(new Vector3(1, 0.7, 1).normalize().multiplyScalar(distance));
    this.camera.near = Math.max(0.01, distance / 10000); this.camera.far = distance * 30;
    this.camera.updateProjectionMatrix(); this.controls.target.copy(center); this.controls.maxDistance = distance * 8; this.controls.update();
  }

  clearResult(): void {
    this.dropStart = undefined; this.dropElapsed = 0; this.dropReady = false;
    this.falling = undefined; this.steady = undefined;
    this.converted.traverse(o => { if (o instanceof Mesh) { o.geometry.dispose(); (o.material as MeshStandardMaterial).dispose(); } }); this.converted.clear();
  }
  private clearOriginal(): void { disposeModel(this.original); this.original.clear(); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.domElement.removeEventListener('wheel', this.updateZoomSpeed, true);
    this.renderer.domElement.removeEventListener('pointerdown', this.updateZoomSpeed, true);
    this.renderer.domElement.removeEventListener('pointermove', this.updateZoomSpeed, true);
    this.renderer.domElement.removeEventListener('click', this.selectLanding, true);
    window.removeEventListener('keydown', this.cancelSelectionKey, true);
    this.controls.removeEventListener('change', this.notifyView);
    cancelAnimationFrame(this.frame); this.observer.disconnect(); this.orbitPinch.dispose(); this.firstPerson.dispose(); this.navigation.dispose(); this.controls.dispose(); this.clearOriginal(); this.clearResult();
    this.collision.setWorld(); this.viewListeners.clear(); this.navigationListeners.clear(); this.activityListeners.clear(); this.noticeListeners.clear();
    this.grid?.geometry.dispose(); (this.grid?.material as import('three').Material | undefined)?.dispose(); this.textures.dispose(); this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
