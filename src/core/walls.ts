import { FAMILIES } from './palette.ts';
import { chunkKey, localIndex, measureChunk, newChunk } from './building.ts';
import { MAX_BRUSH_CELLS, validPoint, wallArea, WALL_LAYOUT_VERSION } from './brush-types.ts';
import type { BuildingChunk, BuildingDocument } from './building.ts';
import type { WallNode, WallPattern, WallPreset } from './brush-types.ts';
import type { Vec3 } from './types.ts';
import { supportColumn, wallColumns } from './wall-layout.ts';

export function validatePattern(pattern: WallPattern): void {
  if (!pattern || !Number.isSafeInteger(pattern.width) || !Number.isSafeInteger(pattern.height) || pattern.width < 1 || pattern.height < 1
    || pattern.width > 64 || pattern.height > 64 || !Array.isArray(pattern.cells) || pattern.cells.length !== pattern.width * pattern.height
    || pattern.cells.some(id => id !== null && !FAMILIES.some(family => family.id === id))) throw new Error('结构模板必须为 1–64 行列的有效方块网格。');
}
export function validatePreset(preset: WallPreset): void {
  if (!preset || typeof preset.id !== 'string' || !preset.id || typeof preset.name !== 'string' || !preset.name.trim()
    || !Array.isArray(preset.structures) || preset.structures.length > 64) throw new Error('墙体预设最多包含 64 项结构。');
  const ids = new Set<string>();
  for (const structure of preset.structures) {
    if (!structure || typeof structure.id !== 'string' || !structure.id || ids.has(structure.id) || typeof structure.name !== 'string' || !structure.name.trim()
      || !['wall', 'station', 'support'].includes(structure.kind) || typeof structure.enabled !== 'boolean' || typeof structure.hollow !== 'boolean'
      || ![structure.thickness, structure.every].every(value => Number.isSafeInteger(value) && value > 0 && value <= 65535)
      || !Number.isSafeInteger(structure.offset) || Math.abs(structure.offset) > 65535) throw new Error('结构参数无效，请检查厚度、间隔与偏移。');
    ids.add(structure.id); validatePattern(structure.pattern);
  }
}
export function validateNode(node: WallNode, presets: WallPreset[]): void {
  if (!node || typeof node.id !== 'string' || !node.id || typeof node.name !== 'string' || !presets.some(preset => preset.id === node.preset)
    || !Array.isArray(node.points) || !node.points.length || node.points.length > 4096 || ![node.closed, node.inside, node.outside].every(value => typeof value === 'boolean')
    || node.points.some(point => !point || !Array.isArray(point.position) || !validPoint(point.position) || (point.control && !validPoint(point.control)))) throw new Error('墙节点坐标或预设无效。');
}
export function sampleWall(node: WallNode): { point: Vec3; tangent: Vec3; column: number }[] {
  const result: { point: Vec3; tangent: Vec3; column: number }[] = [];
  let distance = 0, previous: Vec3 | undefined, sampled = 0, cell = '', score = Infinity;
  const segments = node.points.length - (node.closed ? 0 : 1);
  for (let segment = 0; segment < segments; segment++) {
    const a = node.points[segment].position, end = node.points[(segment + 1) % node.points.length], b = end.position, c = end.control;
    const length = c ? Math.hypot(...a.map((value, axis) => value - c[axis])) + Math.hypot(...b.map((value, axis) => value - c[axis]))
      : Math.hypot(...a.map((value, axis) => value - b[axis]));
    const steps = Math.max(1, Math.ceil(length * 4));
    if (steps > MAX_BRUSH_CELLS || sampled + steps + 1 > MAX_BRUSH_CELLS) throw new Error('墙线过长，请分段创建。');
    sampled += steps + 1;
    for (let i = segment ? 1 : 0; i <= steps; i++) {
      const t = i / steps, point = a.map((value, axis) => c ? (1 - t) ** 2 * value + 2 * (1 - t) * t * c[axis] + t * t * b[axis] : value + t * (b[axis] - value)) as Vec3;
      const tangent = a.map((value, axis) => c ? 2 * (1 - t) * (c[axis] - value) + 2 * t * (b[axis] - c[axis]) : b[axis] - value) as Vec3;
      if (previous) distance += Math.hypot(...point.map((value, axis) => value - previous![axis]));
      previous = point;
      const center = point.map(Math.round) as Vec3, key = center.join(','), error = point.reduce((sum, value, axis) => sum + (value - center[axis]) ** 2, 0);
      const sample = { point: center, tangent, column: Math.floor(distance + 0.5 + 1e-6) };
      // Choose one column per path cell, nearest its center. Half-cell ties otherwise
      // overwrite the preceding column on reverse paths and repeat a support's last column.
      if (key !== cell) { result.push(sample); cell = key; score = error; }
      else if (error < score - 1e-10) { result[result.length - 1] = sample; score = error; }
    }
  }
  return result;
}
/** Procedural output is a cache; paths and presets remain authoritative. */
export interface WallCacheEntry { signature: string; chunks: Map<string, BuildingChunk> }
export function generateWalls(doc: BuildingDocument, cache = new Map<string, WallCacheEntry>()): Map<string, BuildingChunk> {
  const merged = new Map<string, BuildingChunk>(); let chunks = new Map<string, BuildingChunk>(), candidates = 0;
  const material = new Map(doc.families.map((family, index) => [family.id, index]));
  function merge(source: Map<string, BuildingChunk>): void {
    for (const [key, chunk] of source) {
      let target = merged.get(key); if (!target) { target = newChunk(chunk.origin); merged.set(key, target); }
      for (let i = 0; i < 4096; i++) if (chunk.shapes[i]) { target.shapes[i] = chunk.shapes[i]; target.materials[i] = chunk.materials[i]; }
    }
  }
  function add(position: Vec3, id: string | null): void {
    if (!id) return;
    if (!validPoint(position)) throw new Error('墙体超出有效坐标或进入地面以下。');
    const key = chunkKey(...position); let chunk = chunks.get(key);
    if (!chunk) { chunk = newChunk(position); chunks.set(key, chunk); }
    const index = localIndex(position); if (!chunk.shapes[index]) candidates++;
    if (candidates > 32_000_000 || chunks.size * 4096 > 32_000_000) throw new Error('墙体生成超过编辑分块预算。');
    let paint = material.get(id);
    if (paint === undefined) { const family = FAMILIES.find(value => value.id === id)!; paint = doc.families.length; doc.families.push(family); material.set(id, paint); }
    chunk.shapes[index] = 3; chunk.materials[index] = paint;
  }
  for (const node of doc.nodes) {
    validateNode(node, doc.presets); const preset = doc.presets.find(value => value.id === node.preset)!; validatePreset(preset);
    const signature = JSON.stringify([WALL_LAYOUT_VERSION, node, preset]), previous = cache.get(node.id);
    if (previous?.signature === signature) { merge(previous.chunks); continue; }
    chunks = new Map();
    const samples = sampleWall(node), area = wallArea(node), structures = preset.structures.filter(value => value.enabled); let work = 0;
    const wallThickness = Math.max(1, ...structures.filter(value => value.kind === 'wall').map(value => value.thickness));
    const wallNear = -Math.floor((wallThickness - 1) / 2), wallFar = wallNear + wallThickness - 1;
    const layout = wallColumns(structures);
    for (let i = 0; i < samples.length; i++) {
      const { point, tangent, column } = samples[i], horizontal = Math.hypot(tangent[0], tangent[2]);
      if (horizontal < 1e-8) continue;
      const normal = [-tangent[2] / horizontal, 0, tangent[0] / horizontal];
      const slot = layout(column);
      for (const structure of structures) {
        const { pattern, thickness, hollow, kind } = structure;
        if (kind === 'station' && slot.station?.id !== structure.id || kind === 'wall' && slot.station) continue;
        const col = kind === 'support' ? supportColumn(column, structure) : kind === 'station' ? slot.column
          : ((slot.column - structure.offset) % pattern.width + pattern.width) % pattern.width;
        if (col >= pattern.width) continue;
        const near = -Math.floor((thickness - 1) / 2), far = near + thickness - 1;
        for (const side of kind === 'support' ? [-1, 1] : [0]) {
          if (side && Math.abs(area) > 1e-6 && (side === Math.sign(area) ? !node.inside : !node.outside)) continue;
          for (let depth = 0; depth < thickness; depth++) for (let row = 0; row < pattern.height; row++) {
            if (++work > MAX_BRUSH_CELLS * 4) throw new Error('单面墙过大，请缩短路径或降低高度、厚度。');
            if (hollow && depth !== 0 && depth !== thickness - 1 && row !== 0 && row !== pattern.height - 1
              && (kind === 'wall' ? node.closed || i !== 0 && i !== samples.length - 1 : col !== 0 && col !== pattern.width - 1)) continue;
            const offset = side ? (side > 0 ? wallFar : wallNear) + side * (depth + 1) : near + depth;
            add([Math.round(point[0] + normal[0] * offset), Math.round(point[1]) + row, Math.round(point[2] + normal[2] * offset)], pattern.cells[col + row * pattern.width]);
          }
        }
      }
    }
    for (const chunk of chunks.values()) measureChunk(chunk);
    cache.set(node.id, { signature, chunks }); merge(chunks);
  }
  for (const id of cache.keys()) if (!doc.nodes.some(node => node.id === id)) cache.delete(id);
  if (merged.size * 4096 > 32_000_000) throw new Error('墙体生成超过编辑分块预算。');
  for (const chunk of merged.values()) measureChunk(chunk); return merged;
}
