import { SHAPE_BOXES } from './block-shapes.ts';
import type { BlockWorld } from './block-world.ts';
import type { Vec3 } from './types.ts';

export interface BlockHit { position: Vec3; point: Vec3; normal: Vec3; distance: number }
function boxHit(origin: Vec3, direction: Vec3, min: Vec3, max: Vec3): { near: number; far: number; normal: Vec3; exit: Vec3 } | undefined {
  let near = -Infinity, far = Infinity, normal: Vec3 = [0, 0, 0], exit: Vec3 = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(direction[axis]) < 1e-12) { if (origin[axis] < min[axis] || origin[axis] > max[axis]) return; continue; }
    const a = (min[axis] - origin[axis]) / direction[axis], b = (max[axis] - origin[axis]) / direction[axis];
    if (Math.min(a, b) > near) { near = Math.min(a, b); normal = [0, 0, 0]; normal[axis] = direction[axis] > 0 ? -1 : 1; }
    if (Math.max(a, b) < far) { far = Math.max(a, b); exit = [0, 0, 0]; exit[axis] = direction[axis] > 0 ? 1 : -1; }
    if (near > far) return;
  }
  return far < 0 ? undefined : { near, far, normal, exit };
}
/** Grid traversal uses canonical shape boxes, including slabs, stairs and thin shelves. */
export function pickBlock(world: BlockWorld, origin: Vec3, direction: Vec3, maxDistance: number): BlockHit | undefined {
  const bounds = boxHit(origin, direction, world.bounds.min, world.bounds.max); if (!bounds) return;
  let t = Math.max(0, bounds.near) + 1e-7;
  const end = Math.min(maxDistance, bounds.far) + 1e-7;
  const cell = origin.map((value, axis) => Math.floor(value + direction[axis] * t)) as Vec3;
  const step = direction.map(Math.sign), delta = direction.map(value => value ? Math.abs(1 / value) : Infinity);
  const next = origin.map((value, axis) => direction[axis] ? ((cell[axis] + (step[axis] > 0 ? 1 : 0)) - value) / direction[axis] : Infinity);
  for (let count = 0; t <= end && count < 200_000; count++) {
    const shape = world.shapeAt(...cell); let best: BlockHit | undefined;
    for (const box of SHAPE_BOXES[shape] ?? []) {
      const min = box.center.map((value, axis) => cell[axis] + value - box.size[axis] / 2) as Vec3;
      const max = box.center.map((value, axis) => cell[axis] + value + box.size[axis] / 2) as Vec3;
      const hit = boxHit(origin, direction, min, max); if (!hit) continue;
      const distance = hit.near >= 0 ? hit.near : hit.far;
      if (distance > end || (best && distance >= best.distance)) continue;
      best = { position: [...cell], point: origin.map((value, axis) => value + direction[axis] * distance) as Vec3,
        normal: hit.near >= 0 ? hit.normal : hit.exit, distance };
    }
    if (best) return best;
    const axis = next[0] <= next[1] && next[0] <= next[2] ? 0 : next[1] <= next[2] ? 1 : 2;
    t = next[axis]; cell[axis] += step[axis]; next[axis] += delta[axis];
  }
}
