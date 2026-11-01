import { ERASED } from './building.ts';
import { MAX_BRUSH_CELLS } from './brush-types.ts';
import type { BuildingWorld, CellChange } from './building.ts';
import type { BrushSettings } from './brush-types.ts';
import type { Vec3 } from './types.ts';

function surfaceHeight(world: BuildingWorld) {
  const cache = new Map<string, number>();
  return (x: number, z: number): number => {
    const key = `${x},${z}`; if (cache.has(key)) return cache.get(key)!;
    const result = world.topAt(x, z); cache.set(key, result); return result;
  };
}
export function smoothChanges(world: BuildingWorld, center: Vec3, radius: number, strength: number, selected: number): CellChange[] {
  if (!Number.isSafeInteger(radius) || radius < 1 || radius > 64 || !Number.isFinite(strength) || strength <= 0 || strength > 1) throw new Error('平滑半径为 1–64，强度为 0–1。');
  const getHeight = surfaceHeight(world), changes: CellChange[] = [];
  for (let z = center[2] - radius; z <= center[2] + radius; z++) for (let x = center[0] - radius; x <= center[0] + radius; x++) {
    const distance = Math.hypot(x - center[0], z - center[2]); if (distance > radius) continue;
    const height = getHeight(x, z); let average = 0, weights = 0;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) { const weight = Math.exp(-(dx * dx + dz * dz) / 2); average += getHeight(x + dx, z + dz) * weight; weights += weight; }
    const blend = strength * Math.min(1, radius - distance), target = Math.max(-1, Math.round(height + (average / weights - height) * blend));
    const material = world.shapeAt(x, height, z) ? world.materialAt(x, height, z) : selected;
    for (let y = Math.min(height, target) + 1; y <= Math.max(height, target); y++) {
      const position: Vec3 = [x, y, z], removing = y > target;
      if (removing ? !world.shapeAt(...position) : world.shapeAt(...position)) continue;
      changes.push({ position, before: world.overrideAt(position), after: { shape: removing ? ERASED : 3, material } });
      if (changes.length > MAX_BRUSH_CELLS) throw new Error('平滑影响过大，请减小半径或强度。');
    }
  }
  return changes;
}
function random(x: number, z: number, seed: number): number {
  let hash = Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(z | 0, 0x5f356495) ^ Math.imul(seed | 0, 0x6c8e9cf5);
  hash = Math.imul(hash ^ hash >>> 16, 0x7feb352d); hash = Math.imul(hash ^ hash >>> 15, 0x846ca68b);
  return ((hash ^ hash >>> 16) >>> 0) / 4294967296;
}
function noise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), smooth = (v: number) => v * v * (3 - 2 * v), u = smooth(x - ix), v = smooth(z - iz);
  const a = random(ix, iz, seed) * (1 - u) + random(ix + 1, iz, seed) * u;
  const b = random(ix, iz + 1, seed) * (1 - u) + random(ix + 1, iz + 1, seed) * u; return a * (1 - v) + b * v - 0.5;
}
/** Distance to cellular boundaries, rather than F2-F1, keeps the requested crack width consistent. */
export function crackDistance(x: number, z: number, scale: number, seed: number): number {
  const px = x / scale + noise(x / scale / 1.7, z / scale / 1.7, seed + 103) * 0.35;
  const pz = z / scale + noise(x / scale / 1.7, z / scale / 1.7, seed + 211) * 0.35;
  const ix = Math.floor(px), iz = Math.floor(pz);
  const feature = (x: number, z: number): [number, number] => [x + 0.1 + random(x, z, seed) * 0.8, z + 0.1 + random(x, z, seed + 1) * 0.8];
  let winner: [number, number] = [0, 0], winnerCell = [ix, iz], nearest = Infinity;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const p = feature(ix + dx, iz + dz), distance = (p[0] - px) ** 2 + (p[1] - pz) ** 2;
    if (distance < nearest) { nearest = distance; winner = p; winnerCell = [ix + dx, iz + dz]; }
  }
  let edge = Infinity;
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    if (!dx && !dz) continue;
    const p = feature(winnerCell[0] + dx, winnerCell[1] + dz), vx = p[0] - winner[0], vz = p[1] - winner[1], length = Math.hypot(vx, vz);
    edge = Math.min(edge, ((p[0] + winner[0]) / 2 - px) * vx / length + ((p[1] + winner[1]) / 2 - pz) * vz / length);
  }
  return Math.max(0, edge * scale);
}
export function fractureChanges(world: BuildingWorld, center: Vec3, settings: BrushSettings): CellChange[] {
  const { fractureRadius: radius, fractureScale: scale, fractureWidth: width, fractureDepth: depth, fractureSeed: seed } = settings;
  if (![radius, depth, seed].every(Number.isSafeInteger) || radius < 1 || radius > 64 || depth < 1 || depth > 64
    || !Number.isFinite(scale) || scale < 2 || scale > 512 || !Number.isFinite(width) || width < 1 || width > scale / 2) throw new Error('龟裂半径/深度为 1–64，裂块大小 2–512，宽度为 1 至裂块大小的一半，种子为整数。');
  const getHeight = surfaceHeight(world), mask = new Map<string, boolean>(), changes: CellChange[] = [];
  const cracked = (x: number, z: number): boolean => {
    const key = `${x},${z}`; if (!mask.has(key)) mask.set(key, crackDistance(x + 0.5, z + 0.5, scale, seed) <= width / 2); return mask.get(key)!;
  };
  for (let z = center[2] - radius; z <= center[2] + radius; z++) for (let x = center[0] - radius; x <= center[0] + radius; x++) {
    if (Math.hypot(x - center[0], z - center[2]) > radius || !cracked(x, z)) continue;
    const top = getHeight(x, z); if (top < 0 || !world.shapeAt(x, top, z)) continue;
    // Derive depth from intact rims so repainting the same crack does not endlessly dig down.
    const rims: number[] = [], step = Math.ceil(width / 2) + 1;
    for (const [dx, dz] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
      const nx = x + dx * step, nz = z + dz * step, height = getHeight(nx, nz);
      if (!cracked(nx, nz) && height >= 0 && world.shapeAt(nx, height, nz)) rims.push(height);
    }
    if (!rims.length) continue; rims.sort((a, b) => a - b);
    const floor = Math.max(-1, rims[Math.floor(rims.length / 2)] - depth);
    for (let y = top; y > floor; y--) if (world.shapeAt(x, y, z)) {
      const position: Vec3 = [x, y, z]; changes.push({ position, before: world.overrideAt(position), after: { shape: ERASED, material: 0 } });
      if (changes.length > MAX_BRUSH_CELLS) throw new Error('龟裂影响过大，请减小半径或深度。');
    }
  }
  return changes;
}
