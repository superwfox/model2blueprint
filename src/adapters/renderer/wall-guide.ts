import { BoxGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, Matrix4, Vector3 } from 'three';
import type { PerspectiveCamera, Scene, Vector2 } from 'three';
import { constrainWallPoint, wallTurn } from '../../core/wall-guides.ts';
import type { WallNode, WallPoint } from '../../core/brush-types.ts';
import type { Vec3 } from '../../core/types.ts';

export interface WallPick { position: Vec3; connected: boolean; angle?: number; first: boolean; snapped: boolean; control: boolean }
interface ProjectedPoint { position: Vec3; x: number; y: number; z: number }
const NO_POINTS: WallPoint[] = [];
const NODE_RADIUS = 70;

/** Transient node snapping and angle HUD; owns no building data or persistent links. */
export class WallGuide {
  private marker: LineSegments<EdgesGeometry, LineBasicMaterial>;
  private label = document.createElement('div');
  private nodes?: readonly WallNode[];
  private draftId?: string;
  private draftLength = -1;
  private points: Vec3[] = [];
  private projected: ProjectedPoint[] = [];
  private view = new Matrix4();
  private projection = new Matrix4();
  private vector = new Vector3();
  private width = 0;
  private height = 0;
  private dirty = true;
  constructor(private camera: PerspectiveCamera, private canvas: HTMLCanvasElement, private scene: Scene) {
    const box = new BoxGeometry(1, 1, 1);
    this.marker = new LineSegments(new EdgesGeometry(box), new LineBasicMaterial({ color: '#c6b07d', depthTest: false, depthWrite: false })); box.dispose();
    this.marker.visible = false; this.marker.renderOrder = 10000; scene.add(this.marker);
    this.label.className = 'wall-guide-label'; this.label.hidden = true;
    this.label.setAttribute('aria-label', '墙线选点提示'); canvas.parentElement?.append(this.label);
  }
  private prepare(nodes: readonly WallNode[], draft: WallNode | undefined, width: number, height: number): void {
    if (nodes !== this.nodes || draft?.id !== this.draftId || (draft?.points.length ?? 0) !== this.draftLength) {
      this.nodes = nodes; this.draftId = draft?.id; this.draftLength = draft?.points.length ?? 0;
      const positions = new Map<string, Vec3>();
      for (const node of nodes) for (const { position } of node.points) positions.set(position.join(','), position);
      for (const { position } of draft?.points ?? NO_POINTS) positions.set(position.join(','), position);
      this.points = [...positions.values()]; this.dirty = true;
    }
    if (!this.dirty && width === this.width && height === this.height && this.view.equals(this.camera.matrixWorld) && this.projection.equals(this.camera.projectionMatrix)) return;
    this.width = width; this.height = height; this.view.copy(this.camera.matrixWorld); this.projection.copy(this.camera.projectionMatrix); this.dirty = false;
    this.projected = [];
    for (const position of this.points) {
      this.vector.set(...position).addScalar(0.5).project(this.camera);
      if (this.vector.z < -1 || this.vector.z > 1) continue;
      const x = (this.vector.x + 1) * width / 2, y = (1 - this.vector.y) * height / 2;
      if (x < -NODE_RADIUS || x > width + NODE_RADIUS || y < -NODE_RADIUS || y > height + NODE_RADIUS) continue;
      this.projected.push({ position, x, y, z: this.vector.z });
    }
  }
  pick(nodes: readonly WallNode[], draft: WallNode | undefined, pointer: Vector2, position: Vec3 | undefined, height: boolean, angle: boolean, control: boolean): WallPick | undefined {
    const rect = this.canvas.getBoundingClientRect(), points = draft?.points ?? NO_POINTS, last = points.at(-1)?.position;
    this.prepare(nodes, draft, rect.width, rect.height);
    const x = (pointer.x + 1) * rect.width / 2, y = (1 - pointer.y) * rect.height / 2;
    let nearest: ProjectedPoint | undefined, distance = NODE_RADIUS * NODE_RADIUS;
    for (const candidate of this.projected) {
      if (last?.every((value, axis) => value === candidate.position[axis])) continue;
      const squared = (candidate.x - x) ** 2 + (candidate.y - y) ** 2; if (squared > distance) continue;
      const constrained = constrainWallPoint(points, candidate.position, height, angle);
      if (!candidate.position.every((value, axis) => value === constrained[axis])) continue;
      if (squared < distance || !nearest || candidate.z < nearest.z) { nearest = candidate; distance = squared; }
    }
    const target = nearest ? [...nearest.position] as Vec3 : position ? constrainWallPoint(points, position, height, angle) : undefined;
    if (!target) return;
    return { position: target, connected: Boolean(nearest), angle: wallTurn(points, target), first: points.length < 2, snapped: angle && Boolean(last), control };
  }
  show(pick: WallPick): void {
    this.marker.visible = false;
    const rect = this.canvas.getBoundingClientRect();
    this.vector.set(...pick.position).addScalar(0.5).project(this.camera);
    if (this.vector.z < -1 || this.vector.z > 1) { this.hide(); return; }
    if (pick.connected) {
      this.marker.position.set(...pick.position).addScalar(0.5);
      this.marker.visible = true;
    }
    const text: string[] = [];
    if (pick.connected) text.push('连接节点');
    if (pick.angle !== undefined) {
      const degrees = Math.round(pick.angle * 10) / 10;
      text.push(`${pick.control ? '控制点' : pick.first ? '方向' : '转角'} ${Object.is(degrees, -0) ? 0 : degrees}°`);
      if (pick.snapped) text.push('Alt · 45°');
    }
    if (!text.length) { this.label.hidden = true; return; }
    const value = text.join(' · '); if (this.label.textContent !== value) this.label.textContent = value;
    this.label.hidden = false;
    this.label.style.left = `${Math.max(8, Math.min(rect.width - this.label.offsetWidth - 8, (this.vector.x + 1) * rect.width / 2 + 14))}px`;
    this.label.style.top = `${Math.max(8, Math.min(rect.height - this.label.offsetHeight - 8, (1 - this.vector.y) * rect.height / 2 - this.label.offsetHeight - 14))}px`;
  }
  hide(): void { this.marker.visible = false; this.label.hidden = true; }
  reset(): void { this.hide(); this.nodes = undefined; this.draftId = undefined; this.draftLength = -1; this.points = []; this.projected = []; this.dirty = true; }
  dispose(): void { this.reset(); this.label.remove(); this.scene.remove(this.marker); this.marker.geometry.dispose(); this.marker.material.dispose(); }
}
