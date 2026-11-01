import { dimensions } from './block-world.ts';
import type { BuildingWorld } from './building.ts';
import type { VoxelResult } from './types.ts';

export function flattenBuilding(world: BuildingWorld): VoxelResult {
  if (!world.count) throw new Error('空建筑没有可导出的方块。');
  const [width, height, length] = dimensions(world.bounds), cells = width * height * length;
  if (cells > 32_000_000 || Math.max(width, height, length) > 65535) throw new Error('建筑超过导出尺寸上限。');
  const shapes = new Uint8Array(cells), materials = new Uint16Array(cells), [ox, oy, oz] = world.bounds.min;
  const stats = { full: 0, bottom: 0, top: 0, stairs: 0, shelves: 0, solids: world.document.base?.stats.solids ?? 0, milliseconds: 0 };
  const base = world.document.base;
  if (base) for (let y = 0; y < base.size.height; y++) for (let z = 0; z < base.size.length; z++) {
    const start = z * base.size.width + y * base.size.width * base.size.length, offset = -ox + (z - oz) * width + (y - oy) * width * length;
    shapes.set(base.shapes.subarray(start, start + base.size.width), offset); materials.set(base.materials.subarray(start, start + base.size.width), offset);
  }
  for (const chunks of [world.document.generated, world.document.chunks]) for (const chunk of chunks.values()) for (let i = 0; i < 4096; i++) if (chunk.shapes[i]) {
    const x = chunk.origin[0] + i % 16 - ox, y = chunk.origin[1] + Math.floor(i / 256) - oy, z = chunk.origin[2] + Math.floor(i / 16) % 16 - oz;
    const index = x + z * width + y * width * length;
    if (chunks === world.document.generated && shapes[index]) continue;
    shapes[index] = chunk.shapes[i] === 255 ? 0 : chunk.shapes[i]; materials[index] = chunk.materials[i];
  }
  for (let index = 0; index < cells; index++) {
    const shape = shapes[index]; if (!shape) continue;
    if (shape === 3) stats.full++; else if (shape === 1) stats.bottom++; else if (shape === 2) stats.top++; else if (shape < 44) stats.stairs++; else stats.shelves++;
  }
  return { size: { width, height, length, scale: 1 }, shapes, materials, stats };
}
