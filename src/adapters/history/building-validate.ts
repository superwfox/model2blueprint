import { CHUNK_CELLS, chunkKey, upgradeBuilding } from '../../core/building.ts';
import { validateNode, validatePreset } from '../../core/walls.ts';
import { DATA_VERSION } from '../../core/schem.ts';
import { MAX_CELLS } from '../../core/geometry.ts';
import { VoxelWorld, dimensions } from '../../core/block-world.ts';
import type { BuildingSnapshot } from './types.ts';
import { validCamera, validProfiles } from './validate.ts';

export function validateBuilding(snapshot: BuildingSnapshot): void {
  const invalid = () => { throw new Error('建筑记录损坏或版本不兼容，已保留原数据。'); };
  const { entry, document: doc, baseSurface } = snapshot;
  if (doc) upgradeBuilding(doc);
  if (!entry || entry.kind !== 'building' || entry.format !== 1 || entry.dataVersion !== DATA_VERSION || !doc || doc.version !== 2
    || doc.id !== entry.id || !(doc.chunks instanceof Map) || !Array.isArray(doc.families) || !doc.families.length
    || !(doc.generated instanceof Map) || !Array.isArray(doc.nodes) || !Array.isArray(doc.presets)
    || doc.wallLayoutVersion !== undefined && doc.wallLayoutVersion !== 2 && doc.wallLayoutVersion !== 3
    || !Array.isArray(doc.history) || !Number.isSafeInteger(doc.limit) || doc.limit < 1 || !Number.isSafeInteger(doc.cursor)
    || doc.cursor < 0 || doc.cursor > doc.history.length || doc.history.length > doc.limit || !Number.isSafeInteger(doc.revision) || doc.revision < 0) invalid();
  const vector = (value: unknown): value is number[] => Array.isArray(value) && value.length === 3 && value.every(Number.isSafeInteger);
  if (typeof entry.filename !== 'string' || typeof doc.selected !== 'string' || !Number.isFinite(entry.createdAt) || !Number.isFinite(entry.updatedAt)
    || !Number.isFinite(entry.blocks) || !entry.view || entry.view.mode !== 'result') invalid();
  if (!doc.bounds || !vector(doc.bounds.min) || !vector(doc.bounds.max) || doc.bounds.min[1] < 0) invalid();
  const dims = dimensions(doc.bounds);
  if (dims.some(value => value < 0 || value > 65535) || dims[0] * dims[1] * dims[2] > MAX_CELLS) invalid();
  if ((doc.chunks.size + doc.generated.size) * CHUNK_CELLS > MAX_CELLS * 2 || !entry.dimensions
    || entry.dimensions.width !== dims[0] || entry.dimensions.height !== dims[1] || entry.dimensions.length !== dims[2]) invalid();
  for (const family of doc.families) if (!family || !['full', 'slab', 'stairs', 'shelf', 'id'].every(key => typeof family[key as keyof typeof family] === 'string')
    || !Array.isArray(family.color) || family.color.length !== 3 || !family.color.every(Number.isFinite)) invalid();
  for (const chunks of [doc.chunks, doc.generated]) for (const [key, chunk] of chunks) {
    if (!chunk || !vector(chunk.origin) || chunk.origin.some(value => value % 16) || chunk.origin[1] < 0 || key !== chunkKey(...chunk.origin)
      || !(chunk.shapes instanceof Uint8Array) || chunk.shapes.length !== CHUNK_CELLS || !(chunk.materials instanceof Uint16Array) || chunk.materials.length !== CHUNK_CELLS) invalid();
    let count = 0;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < CHUNK_CELLS; i++) if (chunk.shapes[i]) {
      if ((chunks === doc.generated ? chunk.shapes[i] !== 3 : chunk.shapes[i] > 47 && chunk.shapes[i] !== 255) || chunk.materials[i] >= doc.families.length) invalid(); count++;
      const position = [chunk.origin[0] + i % 16, chunk.origin[1] + Math.floor(i / 256), chunk.origin[2] + Math.floor(i / 16) % 16];
      for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], position[axis]); max[axis] = Math.max(max[axis], position[axis] + 1); }
    }
    if (count !== chunk.count || !chunk.bounds || !vector(chunk.bounds.min) || !vector(chunk.bounds.max)) invalid();
    if (!count || min.some((value, axis) => value !== chunk.bounds.min[axis] || max[axis] !== chunk.bounds.max[axis])) invalid();
  }
  try {
    for (const preset of doc.presets) validatePreset(preset);
    for (const node of doc.nodes) validateNode(node, doc.presets);
    for (const action of doc.history) {
      if (!action || typeof action.label !== 'string' || !Array.isArray(action.changes) || action.stroke !== undefined && typeof action.stroke !== 'string') invalid();
      for (const change of action.changes) {
        if (!change || !vector(change.position) || change.position[1] < 0) invalid();
        for (const value of [change.before, change.after]) if (value && (!Number.isInteger(value.shape) || value.shape < 1 || value.shape > 47 && value.shape !== 255
          || !Number.isInteger(value.material) || value.material < 0 || value.material >= doc.families.length)) invalid();
      }
      if (action.presets) for (const value of [...action.presets.before, ...action.presets.after]) validatePreset(value);
      if (action.nodes) {
        const historicalPresets = doc.history.flatMap(item => item.presets ? [...item.presets.before, ...item.presets.after] : []);
        for (const value of [...action.nodes.before, ...action.nodes.after]) validateNode(value, [...doc.presets, ...historicalPresets]);
      }
    }
  } catch { invalid(); }
  if (doc.base) {
    const base = doc.base, size = base.size, cells = size?.width * size?.height * size?.length;
    if (!size || ![size.width, size.height, size.length].every(value => Number.isInteger(value) && value > 0 && value <= 65535)
      || cells > MAX_CELLS || !(base.shapes instanceof Uint8Array) || !(base.materials instanceof Uint16Array)
      || base.shapes.length !== cells || base.materials.length !== cells || !base.stats || !Object.values(base.stats).every(value => Number.isFinite(value) && value >= 0) || !baseSurface) invalid();
    for (let i = 0; i < cells; i++) if (base.shapes[i] > 47 || (base.shapes[i] && base.materials[i] >= doc.families.length)) invalid();
  }
  if (baseSurface && (!(baseSurface.positions instanceof Float32Array) || baseSurface.positions.length % 9
    || !(baseSurface.normals instanceof Float32Array) || baseSurface.normals.length !== baseSurface.positions.length
    || !(baseSurface.colors instanceof Float32Array) || baseSurface.colors.length !== baseSurface.positions.length
    || (baseSurface.textures && (!(baseSurface.textures instanceof Float32Array) || baseSurface.textures.length !== baseSurface.positions.length)))) invalid();
  if (!doc.base && baseSurface?.positions.length) invalid();
  const bounds = doc.base ? new VoxelWorld(doc.base).bounds : { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const chunks of [doc.chunks, doc.generated]) for (const chunk of chunks.values()) for (let axis = 0; axis < 3; axis++) {
    bounds.min[axis] = Math.min(bounds.min[axis], chunk.bounds.min[axis]); bounds.max[axis] = Math.max(bounds.max[axis], chunk.bounds.max[axis]);
  }
  if (!doc.base && !doc.chunks.size && !doc.generated.size) { bounds.min = [0, 0, 0]; bounds.max = [0, 0, 0]; }
  if (bounds.min.some((value, axis) => value !== doc.bounds.min[axis] || bounds.max[axis] !== doc.bounds.max[axis])) invalid();
  if (entry.view?.camera && !validCamera(entry.view.camera)) entry.view.camera = undefined;
  if (entry.view?.navigationProfiles && !validProfiles(entry.view.navigationProfiles)) entry.view.navigationProfiles = undefined;
}
