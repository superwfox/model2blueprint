import { MAX_CELLS } from '../../core/geometry.ts';
import { BLOCK_SHAPES } from '../../core/block-shapes.ts';
import { DATA_VERSION } from '../../core/schem.ts';
import type { CameraState, HistorySnapshot } from './types.ts';
import type { MovementSpeeds, NavigationProfiles } from '../renderer/navigation-types.ts';

export function validSpeeds(value: MovementSpeeds): boolean {
  return Boolean(value && Number.isFinite(value.horizontal) && value.horizontal > 0 && Number.isFinite(value.vertical) && value.vertical > 0);
}
export function validProfiles(value: NavigationProfiles): boolean { return Boolean(value && validSpeeds(value.walking) && validSpeeds(value.flying)); }

function vector(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

export function validCamera(camera: CameraState): boolean {
  return Boolean(camera && vector(camera.position) && vector(camera.target)
    && camera.position.some((value, axis) => value !== camera.target[axis])
    && Number.isFinite(camera.near) && camera.near > 0 && Number.isFinite(camera.far) && camera.far > camera.near
    && Number.isFinite(camera.maxDistance) && camera.maxDistance > 0);
}

export function validateSnapshot(snapshot: HistorySnapshot): void {
  const invalid = () => { throw new Error('此历史记录不完整或版本不兼容，已保留原记录，请重新导入模型。'); };
  const { entry, source, palette, result, surface } = snapshot;
  if (!entry || entry.format !== 1 || entry.dataVersion !== DATA_VERSION || !source || !(source.blob instanceof Blob)
    || !source.model || !Array.isArray(source.model.parts) || !source.model.parts.length || !Array.isArray(source.model.materials)
    || !palette || !Array.isArray(palette.families) || !Array.isArray(palette.manual)
    || palette.families.length !== source.model.materials.length || palette.manual.length !== palette.families.length
    || !result || !surface || !result.size) invalid();
  if (typeof entry.id !== 'string' || typeof entry.filename !== 'string' || !Number.isFinite(entry.createdAt)
    || !Number.isFinite(entry.updatedAt) || !Number.isFinite(entry.blocks) || !result.stats
    || !Object.values(result.stats).every(Number.isFinite)
    || !vector(source.model.min) || !vector(source.model.max) || !Number.isFinite(source.model.triangleCount)) invalid();
  for (const part of source.model.parts) if (!(part.positions instanceof Float64Array) || part.positions.length % 3
    || !(part.indices instanceof Uint32Array) || part.indices.length % 3 || !(part.materials instanceof Uint16Array)
    || part.materials.length !== part.indices.length / 3) invalid();
  for (const family of palette.families) if (!family || typeof family.id !== 'string' || !vector(family.color)
    || !(['full', 'slab', 'stairs', 'shelf'] as const).every(kind => typeof family[kind] === 'string')) invalid();
  for (const flags of palette.manual) if (!flags || !(['slab', 'stairs', 'shelf'] as const).every(kind => typeof flags[kind] === 'boolean')) invalid();
  const { width, height, length, scale } = result.size;
  const cells = width * height * length;
  if (![width, height, length].every(value => Number.isInteger(value) && value > 0 && value <= 65535)
    || cells > MAX_CELLS || !Number.isFinite(scale) || scale <= 0
    || !(result.shapes instanceof Uint8Array) || !(result.materials instanceof Uint16Array)
    || result.shapes.length !== cells || result.materials.length !== cells
    || !Number.isInteger(Number(palette.horizontalSize)) || Number(palette.horizontalSize) <= 0 || Number(palette.horizontalSize) > 65535
    || !entry.dimensions || entry.dimensions.width !== width || entry.dimensions.height !== height || entry.dimensions.length !== length) invalid();
  for (let i = 0; i < cells; i++) if (result.shapes[i] >= BLOCK_SHAPES.length || (result.shapes[i] && result.materials[i] >= palette.families.length)) invalid();
  if (!(surface.positions instanceof Float32Array) || !(surface.normals instanceof Float32Array) || !(surface.colors instanceof Float32Array)
    || surface.positions.length % 9 || surface.normals.length !== surface.positions.length || surface.colors.length !== surface.positions.length
    || (surface.textures && (!(surface.textures instanceof Float32Array) || surface.textures.length !== surface.positions.length))) invalid();
  if (entry.view?.mode !== 'result' && entry.view?.mode !== 'original') invalid();
  // A damaged optional view must not make intact building data inaccessible.
  if (entry.view.camera && !validCamera(entry.view.camera)) entry.view = { ...entry.view, camera: undefined };
  if (entry.view.navigation && !validSpeeds(entry.view.navigation)) entry.view = { ...entry.view, navigation: undefined };
  if (entry.view.navigationProfiles && !validProfiles(entry.view.navigationProfiles)) entry.view = { ...entry.view, navigationProfiles: undefined };
}
