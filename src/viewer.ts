import {
  ACESFilmicToneMapping, Box3, BufferAttribute, BufferGeometry, Color, DirectionalLight, GridHelper,
  Group, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { disposeModel } from './glb.ts';
import { FallingAnimation } from './falling-view.ts';
import { BlockTextures } from './texture-material.ts';
import type { FallingData, GridSize, ModelData, SurfaceData } from './types.ts';

export class Viewer {
  private scene = new Scene();
  private camera = new PerspectiveCamera(40, 1, 0.01, 10000);
  private renderer: WebGLRenderer;
  private controls: OrbitControls;
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
  private textures = new BlockTextures();
  private updateZoomSpeed = (event: WheelEvent | PointerEvent): void => { this.controls.zoomSpeed = event.shiftKey ? 1 : 3; };

  constructor(container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.setClearColor('#000000');
    container.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', '建筑三维预览，可拖动旋转、滚轮缩放，按住 Shift 精细缩放');
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.zoomSpeed = 3;
    this.renderer.domElement.addEventListener('wheel', this.updateZoomSpeed, { capture: true, passive: true });
    this.renderer.domElement.addEventListener('pointerdown', this.updateZoomSpeed, true);
    this.renderer.domElement.addEventListener('pointermove', this.updateZoomSpeed, true);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.scene.add(this.original, this.converted);
    this.scene.add(new HemisphereLight('#dce9f4', '#66725e', 2.3));
    const key = new DirectionalLight('#fff2d8', 3.2); key.position.set(200, 400, 180); this.scene.add(key);
    const fill = new DirectionalLight('#9cbfe2', 1.8); fill.position.set(-180, 120, -140); this.scene.add(fill);
    this.observer = new ResizeObserver(() => {
      const width = container.clientWidth, height = container.clientHeight;
      this.renderer.setSize(width, height); this.camera.aspect = width / Math.max(1, height); this.camera.updateProjectionMatrix();
    });
    this.observer.observe(container);
    const tick = () => {
      this.frame = requestAnimationFrame(tick);
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
      this.controls.update(); this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  setOriginal(scene: import('three').Object3D, model: ModelData, size: GridSize): void {
    this.clearOriginal(); this.clearResult();
    this.original.add(scene); this.resizeModel(model, size);
    this.setMode('original');
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

  setMode(mode: 'original' | 'result'): void {
    this.mode = mode; this.original.visible = mode === 'original'; this.converted.visible = mode === 'result';
  }

  fit(): void {
    if (!this.size) return;
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
    this.renderer.domElement.removeEventListener('wheel', this.updateZoomSpeed, true);
    this.renderer.domElement.removeEventListener('pointerdown', this.updateZoomSpeed, true);
    this.renderer.domElement.removeEventListener('pointermove', this.updateZoomSpeed, true);
    cancelAnimationFrame(this.frame); this.observer.disconnect(); this.controls.dispose(); this.clearOriginal(); this.clearResult();
    this.grid?.geometry.dispose(); (this.grid?.material as import('three').Material | undefined)?.dispose(); this.textures.dispose(); this.renderer.dispose();
  }
}
