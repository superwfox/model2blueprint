import data from '../data/block-textures.json' with { type: 'json' };
import type { BlockFamily, FaceTiles, MaterialTextures } from './types.ts';

export const ATLAS = { columns: data.columns, rows: data.rows, tileSize: data.tileSize };
export function blockTiles(identifier: string): FaceTiles {
  const id = identifier.replace(/^minecraft:/, '').split('[')[0];
  return ((data.blocks as Record<string, number[]>)[id] ?? [0, 0, 0, 0, 0, 0]) as FaceTiles;
}
export function familyTextures(family: BlockFamily): MaterialTextures {
  return { full: blockTiles(family.full), slab: blockTiles(family.slab), stairs: blockTiles(family.stairs), shelf: blockTiles(family.shelf) };
}
export function faceTiles(textures: MaterialTextures, shape: number): FaceTiles {
  let faces = [...(shape >= 44 ? textures.shelf : shape >= 4 ? textures.stairs : shape === 1 || shape === 2 ? textures.slab : textures.full)] as FaceTiles;
  const direction = shape >= 44 ? shape - 44 : shape >= 4 ? Math.floor((shape - 4) % 20 / 5) : 0;
  for (let n = 0; n < direction; n++) faces = [faces[5], faces[4], faces[2], faces[3], faces[0], faces[1]];
  return faces;
}
