import { SHAPE_BOXES } from './block-shapes.ts';
import type { Vec3, VoxelResult } from './types.ts';

export const BODY_HEIGHT = 1.8, EYE_HEIGHT = 1.62;
const RADIUS = 0.3, EPSILON = 1e-5;
const BOXES = SHAPE_BOXES.map(boxes => boxes.map(({ center: c, size: s }) =>
  [c[0] - s[0] / 2, c[1] - s[1] / 2, c[2] - s[2] / 2, c[0] + s[0] / 2, c[1] + s[1] / 2, c[2] + s[2] / 2]));
type Visit = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => void;

/** Local, swept player bounds against canonical shapes; no render geometry or world copy. */
export class WalkingCollision {
  private world?: VoxelResult;
  setWorld(world?: VoxelResult): void { this.world = world; }

  private eachBox(min: Vec3, max: Vec3, visit: Visit): void {
    const world = this.world; if (!world) return;
    const { width, height, length } = world.size;
    const x0 = Math.max(0, Math.floor(min[0] - EPSILON)), x1 = Math.min(width - 1, Math.floor(max[0] + EPSILON));
    const y0 = Math.max(0, Math.floor(min[1] - EPSILON)), y1 = Math.min(height - 1, Math.floor(max[1] + EPSILON));
    const z0 = Math.max(0, Math.floor(min[2] - EPSILON)), z1 = Math.min(length - 1, Math.floor(max[2] + EPSILON));
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const boxes = BOXES[world.shapes[x + z * width + y * width * length]];
      for (const box of boxes) visit(x + box[0], y + box[1], z + box[2], x + box[3], y + box[4], z + box[5]);
    }
  }
  private bounds(feet: Vec3): [Vec3, Vec3] {
    return [[feet[0] - RADIUS, feet[1], feet[2] - RADIUS], [feet[0] + RADIUS, feet[1] + BODY_HEIGHT, feet[2] + RADIUS]];
  }
  sweep(feet: Vec3, axis: number, amount: number): number {
    if (!Number.isFinite(amount) || !amount) return 0;
    let allowed = axis === 1 && amount < 0 ? Math.max(amount, -feet[1]) : amount;
    const [min, max] = this.bounds(feet), low: Vec3 = [...min], high: Vec3 = [...max];
    low[axis] += Math.min(0, allowed); high[axis] += Math.max(0, allowed);
    this.eachBox(low, high, (x0, y0, z0, x1, y1, z1) => {
      if ((axis !== 0 && (max[0] <= x0 + EPSILON || min[0] >= x1 - EPSILON))
        || (axis !== 1 && (max[1] <= y0 + EPSILON || min[1] >= y1 - EPSILON))
        || (axis !== 2 && (max[2] <= z0 + EPSILON || min[2] >= z1 - EPSILON))) return;
      const start = axis === 0 ? x0 : axis === 1 ? y0 : z0;
      const end = axis === 0 ? x1 : axis === 1 ? y1 : z1;
      if (amount > 0 && start >= max[axis] - EPSILON) allowed = Math.min(allowed, Math.max(0, start - max[axis]));
      if (amount < 0 && end <= min[axis] + EPSILON) allowed = Math.max(allowed, Math.min(0, end - min[axis]));
    });
    return allowed;
  }
  move(feet: Vec3, axis: number, amount: number): number {
    const allowed = this.sweep(feet, axis, amount); feet[axis] += allowed; return allowed;
  }
  grounded(feet: Vec3): boolean { return this.sweep(feet, 1, -0.001) > -0.0005; }

  /** Entering on a wall/under an overhang must not leave the walking body inside blocks. */
  makeRoom(feet: Vec3): void {
    feet[1] = Math.max(0, feet[1]);
    for (let attempt = 0; attempt < (this.world?.size.height ?? 0) + 2; attempt++) {
      const [min, max] = this.bounds(feet); let top = feet[1];
      this.eachBox(min, max, (x0, y0, z0, x1, y1, z1) => {
        if (max[0] > x0 + EPSILON && min[0] < x1 - EPSILON && max[2] > z0 + EPSILON && min[2] < z1 - EPSILON
          && max[1] > y0 + EPSILON && min[1] < y1 - EPSILON) top = Math.max(top, y1 + EPSILON);
      });
      if (top === feet[1]) return;
      feet[1] = top;
    }
  }
}
