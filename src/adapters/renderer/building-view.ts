import { BoxGeometry, BufferAttribute, BufferGeometry, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, Raycaster, SphereGeometry, Vector2, Vector3 } from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { MeshStandardMaterial, PerspectiveCamera, Scene } from 'three';
import { StrokeSurface, surfaceTarget } from '../../core/surface-stroke.ts';
import type { StrokeRay } from '../../core/surface-stroke.ts';
import { BuildingWorld } from '../../core/building.ts';
import type { BlockWorld } from '../../core/block-world.ts';
import type { Vec3 } from '../../core/types.ts';
import type { ChunkSurface } from '../editor/protocol.ts';
import { defaultBrush, MAX_BRUSH_CELLS } from '../../core/brush-types.ts';
import type { BrushSettings, WallNode, WallPoint } from '../../core/brush-types.ts';
import type { VoxelResult } from '../../core/types.ts';
import { BaseChunkMask } from './base-chunk-mask.ts';
import { WallGuide } from './wall-guide.ts';
import type { WallPick } from './wall-guide.ts';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const NO_WALLS: WallNode[] = [];
export type EditorIntent = { type: 'enter' | 'exit' | 'undo' | 'redo' } | { type: 'place'; position: Vec3 }
  | { type: 'brush'; a: Vec3; b?: Vec3; stroke?: string } | { type: 'node'; node: WallNode }
  | { type: 'stroke'; stroke: string; rays: StrokeRay[]; end?: boolean };
export class BuildingView {
  readonly blocks = new Group();
  private preview = new Group();
  private cube = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: '#c6b07d', transparent: true, opacity: 0.28, depthWrite: false }));
  private outline = new LineSegments(new EdgesGeometry(this.cube.geometry), new LineBasicMaterial({ color: '#c6b07d', depthTest: false }));
  private grid: LineSegments<BufferGeometry, LineBasicMaterial>;
  private meshes = new Map<string, Mesh<BufferGeometry, MeshStandardMaterial>>();
  private meshTriangles = 0;
  private expected = new Map<string, number>();
  private world?: BlockWorld;
  private walls: readonly WallNode[] = NO_WALLS;
  private editing = false;
  private pointer?: Vector2;
  private down?: { id: number; x: number; y: number; moved: boolean; stroke?: string; orbit: boolean };
  private space = false;
  private shift = false;
  private alt = false;
  private lastPaint = -Infinity;
  private stroke?: { id: string; surface: StrokeSurface; pending: StrokeRay[]; last?: StrokeRay };
  private raycaster = new Raycaster();
  private mask = new BaseChunkMask();
  private settings = defaultBrush();
  private blocked = false;
  private anchor?: Vec3;
  private draft?: WallNode;
  private curveEnd?: Vec3;
  private selectedWall?: WallNode;
  private pathSignature = '';
  private pathCapacity = 0;
  private wallGuide: WallGuide;
  private wallPick?: WallPick;
  private sphere = new Mesh(new SphereGeometry(1, 24, 16), new MeshBasicMaterial({ color: '#c6b07d', wireframe: true, transparent: true, opacity: 0.45, depthWrite: false }));
  private path = new Line2(new LineGeometry(), new LineMaterial({ color: '#c6b07d', linewidth: 5, worldUnits: false, depthTest: false, depthWrite: false }));
  private startMarker = new LineSegments(new EdgesGeometry(this.cube.geometry), new LineBasicMaterial({ color: '#c6b07d', depthTest: false, depthWrite: false }));

  constructor(private camera: PerspectiveCamera, private canvas: HTMLCanvasElement, private scene: Scene, private material: MeshStandardMaterial,
    private allowed: () => boolean, private intent: (action: EditorIntent) => void, private notice: (message: string, failed?: boolean) => void,
    private modelHit: (event: PointerEvent) => boolean, private baseTriangles: () => number, private controls: OrbitControls) {
    const lines: number[] = [];
    for (let i = 0; i <= 5; i++) { const value = i - 2.5; lines.push(value, -2.5, 0, value, 2.5, 0, -2.5, value, 0, 2.5, value, 0); }
    const geometry = new BufferGeometry(); geometry.setAttribute('position', new BufferAttribute(new Float32Array(lines), 3));
    this.grid = new LineSegments(geometry, new LineBasicMaterial({ color: '#c6b07d', transparent: true, opacity: 0.7, depthWrite: false }));
    this.cube.add(this.outline); this.preview.add(this.cube, this.grid, this.sphere); this.preview.visible = false; this.path.visible = false;
    this.path.renderOrder = 9998; this.startMarker.visible = false; this.startMarker.renderOrder = 9999; this.scene.add(this.blocks, this.preview, this.path, this.startMarker);
    this.wallGuide = new WallGuide(camera, canvas, scene);
    canvas.addEventListener('pointerdown', this.pointerDown, true); canvas.addEventListener('pointermove', this.pointerMove, true);
    canvas.addEventListener('pointerup', this.pointerUp, true); canvas.addEventListener('pointercancel', this.cancel, true);
    canvas.addEventListener('pointerleave', this.leave); canvas.addEventListener('lostpointercapture', this.endStroke);
    window.addEventListener('keydown', this.keyDown, true); window.addEventListener('keyup', this.keyUp, true); window.addEventListener('blur', this.cancel);
    document.addEventListener('visibilitychange', this.cancel);
  }
  setWorld(world: BlockWorld | undefined, editing: boolean): void {
    if (this.world !== world) { this.finishStroke(false); this.mask.dispose(); this.clearChunks(); this.finish(); this.walls = NO_WALLS; this.wallGuide.reset(); this.selectedWall = undefined; }
    this.world = world; this.setEditing(editing);
  }
  setEditing(value: boolean): void { this.editing = value; this.space = false; this.shift = false; this.alt = false; this.endStroke(); this.orbitAccess(); this.preview.visible = false; this.wallGuide.hide(); if (!value) this.finish(); }
  private orbitAccess(): void {
    const allow = !this.editing || this.space;
    if (!allow && this.controls.enableRotate) { const damping = this.controls.enableDamping; this.controls.enableDamping = false; this.controls.update(); this.controls.enableDamping = damping; }
    this.controls.enableRotate = allow; this.controls.enablePan = allow;
  }
  setBase(base?: VoxelResult, material?: MeshStandardMaterial): void { this.mask.configure(base, material); }
  // Restored nodes are supplied by the session, independently of wall selection or runtime class identity.
  setWallNodes(nodes: readonly WallNode[]): void {
    if (nodes === this.walls) return;
    this.walls = nodes; this.wallPick = undefined; this.wallGuide.reset();
  }
  setBlocked(value: boolean): void { this.blocked = value; if (value) { this.preview.visible = false; this.wallGuide.hide(); } }
  acceptStroke(id: string, positions: Vec3[]): void { if (this.stroke?.id === id) this.stroke.surface.record(positions); }
  finishDrawing(): void { this.endStroke(); this.finish(); }
  setSettings(value: BrushSettings): void {
    this.endStroke();
    if (value.kind !== this.settings.kind || value.fixed !== this.settings.fixed || value.preset !== this.settings.preset) this.finish();
    this.settings = structuredClone(value);
  }
  highlightWall(node?: WallNode): void { this.selectedWall = node; }
  repickWall(node: WallNode): void {
    this.settings = { ...this.settings, kind: 'wall', preset: node.preset }; this.draft = { ...structuredClone(node), points: [], closed: false };
    this.anchor = undefined; this.curveEnd = undefined; this.notice('重新点击墙线起点，Esc 结束选点。');
  }
  setVisible(value: boolean): void { this.blocks.visible = value; if (!value) { this.preview.visible = false; this.wallGuide.hide(); } }
  markDirty(keys: string[], revision: number): void { for (const key of keys) this.expected.set(key, revision); }
  apply(chunks: ChunkSurface[]): void {
    for (const { key, surface, revision } of chunks) {
      if (revision < (this.expected.get(key) ?? 0)) continue;
      const previous = this.meshes.get(key);
      if (surface.warning) { this.notice(surface.warning, true); continue; }
      const nextTriangles = this.meshTriangles - (previous ? previous.geometry.getAttribute('position').count / 3 : 0) + surface.positions.length / 9;
      const triangles = this.baseTriangles() + nextTriangles;
      if (triangles > 1_250_000) { this.notice('预览超过三角面预算，建筑数据已保留，可下载查看。', true); continue; }
      if (previous) { this.blocks.remove(previous); previous.geometry.dispose(); this.meshes.delete(key); }
      this.meshTriangles = nextTriangles;
      if (!surface.positions.length) { this.mask.mark([key]); continue; }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(surface.positions, 3)); geometry.setAttribute('normal', new BufferAttribute(surface.normals, 3));
      geometry.setAttribute('color', new BufferAttribute(surface.colors, 3)); if (surface.textures) geometry.setAttribute('aTexture', new BufferAttribute(surface.textures, 3));
      geometry.computeBoundingSphere(); const mesh = new Mesh(geometry, this.material); this.meshes.set(key, mesh); this.blocks.add(mesh);
      this.mask.mark([key]);
    }
  }
  private ray(event?: PointerEvent): void {
    if (event) {
      const rect = this.canvas.getBoundingClientRect(); this.pointer = new Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      this.shift = event.shiftKey; this.alt = event.altKey;
    }
    this.camera.updateMatrixWorld(); this.raycaster.setFromCamera(this.pointer!, this.camera);
  }
  private target(): { position: Vec3; point: Vec3; normal: Vec3; error: string; hit?: Vec3 } | undefined {
    if (!this.world || !this.pointer) return;
    const ray = this.raycaster.ray, target = surfaceTarget(this.stroke?.surface ?? this.world, ray.origin.toArray(), ray.direction.toArray(), this.camera.far);
    if (this.settings.kind === 'wall') {
      this.wallPick = this.wallGuide.pick(this.walls, this.draft, this.pointer,
        target?.position, this.shift, this.alt, Boolean(this.curveEnd));
      if (!this.wallPick) return;
      const position = this.wallPick.position;
      return { position, point: [position[0] + 0.5, position[1], position[2] + 0.5] as Vec3, normal: [0, 1, 0] as Vec3,
        error: this.world instanceof BuildingWorld ? this.world.rangeError([position]) : '' };
    }
    if (!target) return;
    let { position } = target; const { point, normal, hit } = target;
    if ((this.settings.kind === 'smooth' || this.settings.kind === 'fracture') && hit) position = [...hit];
    let error = this.settings.kind === 'block' && this.world instanceof BuildingWorld && !this.stroke?.surface.contains(position) ? this.world.placementError(position) : '';
    if (this.world instanceof BuildingWorld && (this.settings.kind === 'box' || this.settings.kind === 'sphere')) {
      const a = this.anchor ?? position;
      if (this.settings.kind === 'box') {
        const min = this.settings.fixed ? position : a.map((value, axis) => Math.min(value, position[axis])) as Vec3;
        const max = this.settings.fixed ? position.map((value, axis) => value + this.settings.size[axis] - 1) as Vec3 : a.map((value, axis) => Math.max(value, position[axis])) as Vec3;
        const cells = max.reduce((value, n, axis) => value * (n - min[axis] + 1), 1); error = cells > MAX_BRUSH_CELLS ? '单次笔刷范围最多 262,144 格。' : this.world.rangeError([min, max]);
      } else {
        const radius = this.settings.fixed ? this.settings.radius : this.anchor ? Math.hypot(...a.map((value, axis) => value - position[axis])) : 0;
        const min = a.map(value => Math.floor(value - radius)) as Vec3, max = a.map(value => Math.ceil(value + radius)) as Vec3;
        error = (2 * Math.ceil(radius) + 1) ** 3 > MAX_BRUSH_CELLS ? '单次笔刷范围最多 262,144 格。' : this.world.rangeError([min, max]);
      }
    }
    return { position, point, normal, hit, error };
  }
  update(): void {
    this.path.visible = false; this.startMarker.visible = false;
    if (!this.editing || this.blocked || !this.allowed() || !this.blocks.visible || !this.world) { this.preview.visible = false; this.wallGuide.hide(); return; }
    if (this.stroke?.pending.length) { this.flushStroke(); if (this.blocked) return; }
    if (this.selectedWall && !this.draft) this.drawPath(this.selectedWall);
    if (!this.pointer) { this.preview.visible = false; this.wallGuide.hide(); return; }
    this.ray(); const target = this.target(); this.preview.visible = !this.space && Boolean(target);
    if (!target) { this.wallGuide.hide(); return; }
    if (this.settings.kind === 'wall' && !this.space && this.wallPick) this.wallGuide.show(this.wallPick);
    else this.wallGuide.hide();
    if (this.settings.kind === 'smooth' && this.down?.stroke && !this.space && performance.now() - this.lastPaint >= 120) this.paint(target);
    const color = target.error ? '#96c9df' : '#c6b07d'; this.cube.material.color.set(color); this.outline.material.color.set(color); this.grid.material.color.set(color);
    this.sphere.material.color.set(color);
    this.cube.position.set(...target.position).addScalar(0.5);
    this.cube.scale.set(1, 1, 1); this.cube.visible = this.settings.kind !== 'sphere' && !(this.settings.kind === 'wall' && this.wallPick?.connected); this.sphere.visible = this.settings.kind === 'sphere';
    if (this.settings.kind === 'box') {
      const a = this.anchor ?? target.position, b = target.position;
      const size = this.settings.fixed ? this.settings.size : a.map((value, axis) => Math.abs(value - b[axis]) + 1) as Vec3;
      const min = this.settings.fixed ? b : a.map((value, axis) => Math.min(value, b[axis]));
      this.cube.scale.set(...size); this.cube.position.set(min[0] + size[0] / 2, min[1] + size[1] / 2, min[2] + size[2] / 2);
    } else if (this.settings.kind === 'sphere') {
      const a = this.anchor ?? target.position, radius = this.settings.fixed ? this.settings.radius : this.anchor ? Math.hypot(...a.map((value, axis) => value - target.position[axis])) : 0.5;
      this.sphere.scale.setScalar(Math.max(0.01, radius)); this.sphere.position.set(...a).addScalar(0.5);
    } else if (this.settings.kind === 'smooth' || this.settings.kind === 'fracture') {
      const radius = this.settings.kind === 'smooth' ? this.settings.smoothRadius : this.settings.fractureRadius;
      this.cube.scale.set(radius * 2 + 1, 0.05, radius * 2 + 1); this.cube.position.y = target.point[1] + 0.02;
    } else if (this.settings.kind === 'wall' && this.draft) {
      const node = { ...this.draft, points: [...this.draft.points] };
      node.points.push({ position: this.curveEnd ?? target.position, control: this.curveEnd ? target.position : undefined }); this.drawPath(node);
    }
    const axis = target.normal.findIndex(value => value !== 0), center: Vec3 = target.position.map(value => value + 0.5) as Vec3;
    center[axis] = target.point[axis] + target.normal[axis] * 0.003;
    this.grid.position.set(...center); this.grid.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...target.normal));
  }
  private pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !event.isPrimary || !this.allowed() || this.blocked) return;
    this.canvas.focus({ preventScroll: true });
    this.down = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, orbit: this.space };
    if (!this.editing || this.space) return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.canvas.setPointerCapture(event.pointerId); this.ray(event);
    if (['block', 'smooth'].includes(this.settings.kind) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      this.down.stroke = crypto.randomUUID(); this.lastPaint = -Infinity;
      if (this.settings.kind === 'block' && this.world) {
        this.stroke = { id: this.down.stroke, surface: new StrokeSurface(this.world), pending: [] }; this.queueRay(event); this.flushStroke();
      } else { const target = this.target(); if (target) this.paint(target); }
    }
  };
  private queueRay(event: PointerEvent): void {
    const stroke = this.stroke; if (!stroke) return; this.ray(event);
    const ray = this.raycaster.ray, sample: StrokeRay = { origin: ray.origin.toArray(), direction: ray.direction.toArray(), pixel: [event.clientX, event.clientY], far: this.camera.far };
    if (stroke.last && sample.origin.every((value, i) => value === stroke.last!.origin[i]) && sample.direction.every((value, i) => value === stroke.last!.direction[i])) return;
    stroke.last = sample; stroke.pending.push(sample);
    if (stroke.pending.length >= 128) this.flushStroke();
  }
  private flushStroke(): void {
    if (!this.stroke?.pending.length) return;
    this.intent({ type: 'stroke', stroke: this.stroke.id, rays: this.stroke.pending.splice(0, 128) });
  }
  private paint(target: NonNullable<ReturnType<BuildingView['target']>>): void {
    if (!this.down?.stroke || this.blocked || target.error) return;
    this.lastPaint = performance.now(); this.intent({ type: 'brush', a: target.position, stroke: this.down.stroke });
  }
  private pointerMove = (event: PointerEvent): void => {
    if (this.down && Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) > 5) this.down.moved = true;
    const rect = this.canvas.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) { this.endStroke(); this.leave(); return; }
    this.ray(event);
    if (this.stroke) this.queueRay(event);
  };
  private pointerUp = (event: PointerEvent): void => {
    if (this.stroke && this.down?.id === event.pointerId) this.queueRay(event);
    const down = this.down; this.endStroke();
    if (down?.stroke || down?.orbit || this.space) return;
    if (!down || down.id !== event.pointerId || down.moved || event.button !== 0 || ((event.ctrlKey || event.altKey) && this.settings.kind !== 'wall') || event.metaKey || this.blocked || !this.allowed() || !this.world) return;
    this.ray(event);
    if (!this.editing) { if (this.modelHit(event)) this.intent({ type: 'enter' }); return; }
    const target = this.target(); if (!target) return;
    if (target.error) { this.notice(target.error, true); return; }
    if (this.settings.kind === 'wall') { this.wallClick(target.position, event); return; }
    if ((this.settings.kind === 'box' || this.settings.kind === 'sphere') && !this.settings.fixed) {
      if (!this.anchor) { this.anchor = [...target.position]; this.notice(this.settings.kind === 'box' ? '已选第一角点，点击表面或地面的对角点；Esc 取消。' : '已选球心，点击半径点；Esc 取消。'); return; }
      const a = this.anchor; this.anchor = undefined; this.intent({ type: 'brush', a, b: target.position }); return;
    }
    this.intent({ type: 'brush', a: target.position });
  };
  private wallClick(position: Vec3, event: PointerEvent): void {
    if (!this.settings.preset) { this.notice('请先选择墙体预设。', true); return; }
    if (!this.draft) this.draft = { id: crypto.randomUUID(), name: '墙体', preset: this.settings.preset, points: [], closed: false, inside: true, outside: true };
    const node = this.draft, last = node.points.at(-1);
    if (node.points.length >= 4096) { this.notice('单条墙线最多 4096 点，请按 Esc 结束后另起一条。', true); return; }
    const point: Vec3 = [...position];
    if (!last) { node.points.push({ position: point }); this.notice('靠近已有节点可连接；Alt 吸附 45° 角度，Shift 保持高度，Ctrl 选曲线端点；Esc 结束。'); return; }
    if (!this.curveEnd && event.ctrlKey) { this.curveEnd = point; this.notice('点击贝塞尔控制点调整弧度。'); return; }
    const next: WallPoint = { position: this.curveEnd ?? point, control: this.curveEnd ? point : undefined }; this.curveEnd = undefined;
    if (node.points.length >= 3 && next.position.every((value, axis) => value === node.points[0].position[axis])) {
      node.closed = true; node.points[0] = { ...node.points[0], control: next.control };
      this.intent({ type: 'node', node: structuredClone(node) }); this.finish(); this.notice('墙线已闭合，可在节点面板调整内外支撑。'); return;
    }
    if (next.position.every((value, axis) => value === last.position[axis])) return;
    node.points.push(next); this.intent({ type: 'node', node: structuredClone(node) });
  }
  private finish(): void { this.anchor = undefined; this.draft = undefined; this.curveEnd = undefined; this.path.visible = false; this.startMarker.visible = false; this.wallPick = undefined; this.wallGuide.hide(); }
  private drawPath(node: WallNode): void {
    if (this.draft?.points.length) { this.startMarker.position.set(...this.draft.points[0].position).addScalar(0.5); this.startMarker.visible = true; }
    const signature = JSON.stringify(node); if (signature === this.pathSignature) { this.path.visible = node.points.length > 1; return; } this.pathSignature = signature;
    const points: Vector3[] = [];
    const curveSteps = Math.max(1, Math.min(24, Math.floor(8192 / Math.max(1, node.points.length))));
    for (let i = 0; i < node.points.length; i++) {
      const point = node.points[i], a = node.points[(i + node.points.length - 1) % node.points.length]?.position;
      if (point.control && (i > 0 || node.closed)) {
        for (let step = 0; step <= curveSteps; step++) { const t = step / curveSteps; points.push(new Vector3(...a.map((value, axis) => (1 - t) ** 2 * value + 2 * (1 - t) * t * point.control![axis] + t * t * point.position[axis]) as Vec3).addScalar(0.5)); }
      } else points.push(new Vector3(...point.position).addScalar(0.5));
    }
    if (node.closed && points.length) points.push(points[0].clone());
    const segments = Math.max(0, points.length - 1);
    if (segments > this.pathCapacity) {
      this.pathCapacity = 2 ** Math.ceil(Math.log2(segments));
      this.path.geometry.dispose(); this.path.geometry = new LineGeometry().setPositions(new Float32Array((this.pathCapacity + 1) * 3));
    }
    if (segments) {
      const start = this.path.geometry.getAttribute('instanceStart'), end = this.path.geometry.getAttribute('instanceEnd');
      for (let i = 0; i < segments; i++) { start.setXYZ(i, points[i].x, points[i].y, points[i].z); end.setXYZ(i, points[i + 1].x, points[i + 1].y, points[i + 1].z); }
      start.needsUpdate = true; end.needsUpdate = true;
      this.path.geometry.computeBoundingBox(); this.path.geometry.computeBoundingSphere();
    }
    this.path.geometry.instanceCount = segments; this.path.visible = segments > 0;
  }
  private keyDown = (event: KeyboardEvent): void => {
    if (!this.editing || event.isComposing) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable=false])')) return;
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') { this.shift = true; return; }
    if (event.code === 'AltLeft' || event.code === 'AltRight') {
      this.alt = true;
      if (this.settings.kind === 'wall' && document.activeElement === this.canvas) event.preventDefault();
      return;
    }
    if (event.altKey) return;
    if (event.code === 'Space' && (this.allowed() || this.space)) {
      event.preventDefault(); this.space = true; this.endStroke(); this.orbitAccess(); this.preview.visible = false; this.wallGuide.hide(); return;
    }
    if (this.blocked || !this.allowed()) return;
    if (event.code === 'Escape') { event.preventDefault(); event.stopImmediatePropagation();
      if (this.draft || this.anchor) { this.finish(); this.notice('已结束当前选点，继续选择起点或再次按 Esc 返回预览。'); }
      else this.intent({ type: 'exit' }); return; }
    if (event.code === 'Enter' && this.draft) { event.preventDefault(); this.finish(); return; }
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.code === 'KeyZ' || event.code === 'KeyY') {
      event.preventDefault(); event.stopImmediatePropagation(); this.intent({ type: event.code === 'KeyY' || event.shiftKey ? 'redo' : 'undo' });
    }
  };
  private keyUp = (event: KeyboardEvent): void => {
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') this.shift = event.shiftKey;
    if (event.code === 'AltLeft' || event.code === 'AltRight') {
      this.alt = event.altKey;
      if (this.editing && this.settings.kind === 'wall' && document.activeElement === this.canvas) event.preventDefault();
    }
    if (event.code === 'Space') { this.space = false; this.endStroke(); this.orbitAccess(); }
  };
  private endStroke = (): void => { this.finishStroke(true); };
  private finishStroke(commit: boolean): void {
    const stroke = this.stroke; this.stroke = undefined;
    if (commit && stroke) {
      while (stroke.pending.length > 128) this.intent({ type: 'stroke', stroke: stroke.id, rays: stroke.pending.splice(0, 128) });
      this.intent({ type: 'stroke', stroke: stroke.id, rays: stroke.pending, end: true });
    }
    const down = this.down; this.down = undefined;
    if (down && this.canvas.hasPointerCapture(down.id)) this.canvas.releasePointerCapture(down.id);
  }
  private cancel = (): void => { this.endStroke(); this.space = false; this.shift = false; this.alt = false; this.orbitAccess(); this.leave(); };
  private leave = (): void => { this.pointer = undefined; this.preview.visible = false; this.wallGuide.hide(); };
  private clearChunks(): void { for (const mesh of this.meshes.values()) mesh.geometry.dispose(); this.meshes.clear(); this.meshTriangles = 0; this.expected.clear(); this.blocks.clear(); }
  dispose(): void {
    this.finishStroke(false);
    this.cancel();
    this.clearChunks(); this.mask.dispose(); this.wallGuide.dispose(); this.walls = NO_WALLS; this.scene.remove(this.blocks, this.preview, this.path, this.startMarker); this.cube.geometry.dispose(); this.cube.material.dispose();
    this.startMarker.geometry.dispose(); this.startMarker.material.dispose();
    this.sphere.geometry.dispose(); this.sphere.material.dispose(); this.path.geometry.dispose(); this.path.material.dispose();
    this.outline.geometry.dispose(); this.outline.material.dispose(); this.grid.geometry.dispose(); this.grid.material.dispose(); this.material.dispose();
    this.canvas.removeEventListener('pointerdown', this.pointerDown, true); this.canvas.removeEventListener('pointermove', this.pointerMove, true);
    this.canvas.removeEventListener('pointerup', this.pointerUp, true); this.canvas.removeEventListener('pointercancel', this.cancel, true);
    this.canvas.removeEventListener('pointerleave', this.leave); this.canvas.removeEventListener('lostpointercapture', this.endStroke);
    window.removeEventListener('keydown', this.keyDown, true); window.removeEventListener('keyup', this.keyUp, true); window.removeEventListener('blur', this.cancel);
    document.removeEventListener('visibilitychange', this.cancel);
  }
}
