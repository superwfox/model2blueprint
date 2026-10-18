import type { BlockFamily, Vec3 } from './types.ts';

export type Facing = 'north' | 'east' | 'south' | 'west';
export type StairTurn = 'straight' | 'inner_left' | 'inner_right' | 'outer_left' | 'outer_right';
interface BlockShape { mask: number; facing?: Facing; half?: 'bottom' | 'top'; turn?: StairTurn }
export interface ShapeBox { center: Vec3; size: Vec3 }

// Bits x + 2*z + 4*y describe eight half-size cubes. Minecraft facing points at the tall side.
const facings: Facing[] = ['north', 'east', 'south', 'west'];
const footprints = [0b0011, 0b1010, 0b1100, 0b0101];
const turns: StairTurn[] = ['straight', 'inner_left', 'inner_right', 'outer_left', 'outer_right'];
export const BLOCK_SHAPES: BlockShape[] = [{ mask: 0 }, { mask: 15 }, { mask: 240 }, { mask: 255 }];
for (const half of ['bottom', 'top'] as const) for (let direction = 0; direction < 4; direction++) {
  const front = footprints[direction], left = footprints[(direction + 3) % 4], right = footprints[(direction + 1) % 4];
  const masks = [front, front | left, front | right, front & left, front & right];
  for (let turn = 0; turn < turns.length; turn++) BLOCK_SHAPES.push({
    mask: half === 'bottom' ? 15 | (masks[turn] << 4) : 240 | masks[turn],
    facing: facings[direction], half, turn: turns[turn],
  });
}
export const SHAPE_MASKS = Uint8Array.from(BLOCK_SHAPES, shape => shape.mask);
const unique = [...new Map(BLOCK_SHAPES.map((shape, id) => [shape.mask, id])).values()];
const exact = new Int16Array(256).fill(-1);
// Prefer the first equivalent state, and straight stairs before corner states.
BLOCK_SHAPES.forEach((shape, id) => { if (exact[shape.mask] < 0) exact[shape.mask] = id; });

export function fitShape(coverage: Float32Array, offset: number, tieMask: number): number {
  let mask = 0;
  for (let bit = 0; bit < 8; bit++) {
    const c = coverage[offset + bit];
    if (c > 0.5 + 1e-6 || (Math.abs(c - 0.5) <= 1e-6 && (tieMask & (1 << bit)))) mask |= 1 << bit;
  }
  if (exact[mask] >= 0) return exact[mask];
  let best = 0, bestError = Infinity;
  for (const id of unique) {
    const shape = SHAPE_MASKS[id];
    let error = id >= 4 ? 0.025 : 0; // Only choose a stair when it improves geometric coverage.
    for (let bit = 0; bit < 8; bit++) error += shape & (1 << bit) ? 1 - coverage[offset + bit] : coverage[offset + bit];
    if (error < bestError - 1e-6) { bestError = error; best = id; }
  }
  return best;
}

export function blockState(family: BlockFamily, shape: number): string {
  if (shape === 0) return 'minecraft:air';
  if (shape === 3) return family.full;
  if (shape === 1 || shape === 2) return `${family.slab}[type=${shape === 1 ? 'bottom' : 'top'},waterlogged=false]`;
  const state = BLOCK_SHAPES[shape];
  if (!state?.facing) throw new Error('输出中包含无效方块形状。');
  return `${family.stairs}[facing=${state.facing},half=${state.half},shape=${state.turn},waterlogged=false]`;
}

function boxes(shape: number): ShapeBox[] {
  const mask = SHAPE_MASKS[shape];
  if (!mask) return [];
  if (shape === 3) return [{ center: [0.5, 0.5, 0.5], size: [1, 1, 1] }];
  const result: ShapeBox[] = [];
  for (let half = 0; half < 2; half++) {
    let remaining = (mask >> (half * 4)) & 15;
    for (let z = 0; z < 2; z++) for (let x = 0; x < 2; x++) {
      const bit = x + z * 2;
      if (!(remaining & (1 << bit))) continue;
      const width = x === 0 && (remaining & (1 << (bit + 1))) ? 2 : 1;
      const depth = z === 0 && Array.from({ length: width }, (_, dx) => remaining & (1 << (bit + dx + 2))).every(Boolean) ? 2 : 1;
      for (let dz = 0; dz < depth; dz++) for (let dx = 0; dx < width; dx++) remaining &= ~(1 << (bit + dx + dz * 2));
      result.push({ center: [x / 2 + width / 4, half / 2 + 0.25, z / 2 + depth / 4], size: [width / 2, 0.5, depth / 2] });
    }
  }
  return result;
}
export const SHAPE_BOXES = BLOCK_SHAPES.map((_, id) => boxes(id));
