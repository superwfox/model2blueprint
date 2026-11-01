import { pickBlock } from './building-pick.ts';
import { MAX_BRUSH_CELLS, validPoint } from './brush-types.ts';
import type { BlockWorld } from './block-world.ts';
import type { Vec3 } from './types.ts';

export interface StrokeRay { origin: Vec3; direction: Vec3; pixel: [number, number]; far: number }
export interface SurfaceTarget { position: Vec3; point: Vec3; normal: Vec3; hit?: Vec3 }
/** A read-through view of the original surface, excluding only this stroke's additions. */
export class StrokeSurface implements BlockWorld {
  readonly bounds;
  private world: BlockWorld;
  private added = new Set<string>();
  constructor(world: BlockWorld) { this.world = world; this.bounds = { min: [...world.bounds.min] as Vec3, max: [...world.bounds.max] as Vec3 }; }
  record(positions: Vec3[]): void { for (const position of positions) this.added.add(position.join(',')); }
  contains(position: Vec3): boolean { return this.added.has(position.join(',')); }
  shapeAt(x: number, y: number, z: number): number { return this.added.has(`${x},${y},${z}`) ? 0 : this.world.shapeAt(x, y, z); }
  materialAt(x: number, y: number, z: number): number { return this.world.materialAt(x, y, z); }
}
export function surfaceTarget(world: BlockWorld, origin: Vec3, direction: Vec3, far: number): SurfaceTarget | undefined {
  const hit = pickBlock(world, origin, direction, far), ground = direction[1] < -1e-9 ? -origin[1] / direction[1] : Infinity;
  if (hit && hit.distance <= ground) return { position: hit.position.map((value, axis) => value + hit.normal[axis]) as Vec3,
    point: hit.point, normal: hit.normal, hit: hit.position };
  if (ground >= 0 && ground <= far) {
    const point = origin.map((value, axis) => value + ground * direction[axis]) as Vec3;
    return { position: [Math.floor(point[0]), 0, Math.floor(point[2])], point, normal: [0, 1, 0] };
  }
}
/** Continuous grid traversal, with deterministic edge/corner ties, independent of input speed. */
export function* strokeCells(a: Vec3, b: Vec3): Generator<Vec3> {
  const cell = a.map(Math.floor) as Vec3, end = b.map(Math.floor), direction = b.map((value, axis) => value - a[axis]);
  const steps = direction.map(Math.sign), delta = direction.map(value => value ? Math.abs(1 / value) : Infinity);
  const next = direction.map((value, axis) => value && cell[axis] !== end[axis] ? (cell[axis] + (value > 0 ? 1 : 0) - a[axis]) / value : Infinity);
  if (end.reduce((sum, value, axis) => sum + Math.abs(value - cell[axis]), 0) > MAX_BRUSH_CELLS) throw new Error('连续绘制跨度过大，请分段绘制。');
  yield [...cell];
  while (cell.some((value, axis) => value !== end[axis])) {
    const t = Math.min(...next);
    for (let axis = 0; axis < 3; axis++) if (next[axis] <= t + 1e-10 && cell[axis] !== end[axis]) {
      cell[axis] += steps[axis]; next[axis] = cell[axis] === end[axis] ? Infinity : next[axis] + delta[axis]; yield [...cell];
    }
  }
}
function paintPoint(target: SurfaceTarget): Vec3 {
  return target.point.map((value, axis) => target.normal[axis] ? target.position[axis] + 0.5
    : Math.max(target.position[axis] + 1e-7, Math.min(target.position[axis] + 1 - 1e-7, value))) as Vec3;
}
export class SurfaceStroke {
  readonly surface: StrokeSurface;
  private previous?: StrokeRay;
  private previousTarget?: SurfaceTarget;
  failed = false;
  constructor(world: BlockWorld) { this.surface = new StrokeSurface(world); }
  trace(rays: StrokeRay[]): Vec3[] {
    if (this.failed) return [];
    if (!Array.isArray(rays) || rays.length > 256) throw new Error('连续绘制输入过多，请分段绘制。');
    const cells = new Map<string, Vec3>(); let work = 0, traversed = 0;
    const add = (position: Vec3) => {
      if (++traversed > MAX_BRUSH_CELLS * 4) throw new Error('连续绘制范围过大，请分段绘制。');
      if (!validPoint(position) || this.surface.shapeAt(...position)) return;
      const surface = position[1] === 0 || [0, 1, 2].some(axis => [-1, 1].some(step => {
        const neighbor: Vec3 = [...position]; neighbor[axis] += step; return Boolean(this.surface.shapeAt(...neighbor));
      }));
      if (surface) cells.set(position.join(','), position);
      if (cells.size > MAX_BRUSH_CELLS) throw new Error('一次连续操作最多修改 262,144 格。');
    };
    const sample = (ray: StrokeRay) => {
      if (++work > 8192) throw new Error('表面跨度过大，请缩短本次连续绘制。');
      const target = surfaceTarget(this.surface, ray.origin, ray.direction, ray.far);
      if (target) {
        const point = paintPoint(target);
        if (this.previousTarget) for (const cell of strokeCells(paintPoint(this.previousTarget), point)) add(cell);
        else add(target.position);
      }
      this.previousTarget = target;
    };
    for (const ray of rays) {
      if (!ray || !Array.isArray(ray.origin) || !Array.isArray(ray.direction) || !Array.isArray(ray.pixel)
        || ray.origin.length !== 3 || ray.direction.length !== 3 || ray.pixel.length !== 2
        || ![...ray.origin, ...ray.direction, ...ray.pixel, ray.far].every(Number.isFinite) || ray.far <= 0
        || Math.abs(Math.hypot(...ray.direction) - 1) > 1e-5) throw new Error('连续绘制射线无效。');
      const previous = this.previous;
      if (!previous) sample(ray);
      else {
        const a = this.previousTarget, b = surfaceTarget(this.surface, ray.origin, ray.direction, ray.far);
        const pixels = Math.hypot(ray.pixel[0] - previous.pixel[0], ray.pixel[1] - previous.pixel[1]);
        const distance = a && b ? Math.hypot(...a.point.map((value, axis) => value - b.point[axis])) : 0;
        const count = Math.min(2048, Math.max(1, Math.ceil(Math.max(pixels / 3, distance * 2))));
        for (let i = 1; i <= count; i++) {
          const t = i / count, direction = ray.direction.map((value, axis) => previous.direction[axis] + (value - previous.direction[axis]) * t) as Vec3;
          const length = Math.hypot(...direction); if (length < 1e-10) { this.previousTarget = undefined; continue; }
          sample({ ...ray, origin: ray.origin.map((value, axis) => previous.origin[axis] + (value - previous.origin[axis]) * t) as Vec3,
            direction: direction.map(value => value / length) as Vec3 });
        }
      }
      this.previous = ray;
    }
    return [...cells.values()];
  }
}
