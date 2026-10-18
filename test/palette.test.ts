import { test } from 'node:test';
import assert from 'node:assert/strict';
import registry from '../scripts/data/minecraft-26.3-blocks.json' with { type: 'json' };
import { FAMILIES, FULL_BLOCKS, SLABS, STAIRS, suggestFamily } from '../src/palette.ts';
import { familyColors } from '../src/colors.ts';
import { encodeSchem } from '../src/schem.ts';
import { meshSurface } from '../src/surface.ts';
import { fallingBlocks } from '../src/falling-data.ts';
import { readNbt, readVarInts } from './nbt-reader.ts';
import type { MaterialColors, VoxelResult } from '../src/types.ts';

const states = registry as unknown as Record<string, [Record<string, string[]>, Record<string, string>]>;
function grid(shapes: number[], materials = new Uint16Array(shapes.length)): VoxelResult {
  return { size: { width: shapes.length, length: 1, height: 1, scale: 1 }, shapes: Uint8Array.from(shapes), materials,
    stats: { full: 0, bottom: 0, top: 0, stairs: 0, solids: 0, milliseconds: 0 } };
}

test('catalog covers building colors, wood, foliage, glass, ore, copper families and all real slab/stair IDs', () => {
  const full = new Set(FULL_BLOCKS.map(block => block.id));
  for (const id of ['stone', 'dirt', 'grass_block', 'sand', 'gravel', 'mud', 'snow_block', 'glass', 'tinted_glass',
    'oak_leaves', 'red_poplar_leaves', 'poplar_planks', 'diamond_ore', 'netherite_block', 'basalt', 'calcite',
    'white_terracotta', 'white_glazed_terracotta', 'white_concrete_powder', 'moss_block',
    'copper_block', 'exposed_copper', 'waxed_oxidized_cut_copper', 'waxed_weathered_chiseled_copper', 'sea_lantern']) assert.ok(full.has(id), id);
  const expectedSlabs = Object.keys(states).filter(id => id.endsWith('_slab') && states[id][0].type?.includes('double')).sort();
  const expectedStairs = Object.keys(states).filter(id => id.endsWith('_stairs')).sort();
  assert.deepEqual(SLABS.map(block => block.id).sort(), expectedSlabs);
  assert.deepEqual(STAIRS.map(block => block.id).sort(), expectedStairs);
  assert.equal(full.size, FULL_BLOCKS.length);
});

test('containers, workstations, redstone machinery and technical blocks never enter the material palette', () => {
  const ids = new Set(FULL_BLOCKS.map(block => block.id));
  for (const id of ['chest', 'barrel', 'white_shulker_box', 'copper_chest', 'crafting_table', 'crafter', 'furnace',
    'chiseled_bookshelf', 'observer', 'redstone_block', 'copper_bulb', 'waxed_oxidized_copper_bulb', 'command_block',
    'structure_block', 'spawner', 'creaking_heart', 'budding_amethyst', 'bookshelf']) assert.equal(ids.has(id), false, id);
});

test('all 16 wool and concrete colors have genuine matching full/slab/stair mappings', () => {
  const dyes = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray',
    'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
  for (const dye of dyes) for (const material of ['wool', 'concrete']) {
    const family = FAMILIES.find(block => block.id === `${dye}_${material}`)!;
    assert.ok(family); assert.equal(family.slab, `minecraft:${dye}_${material}_slab`);
    assert.equal(family.stairs, `minecraft:${dye}_${material}_stairs`);
  }
});

test('every exported state of every material is legal in the independently generated 26.3 registry', () => {
  const shapes = FAMILIES.flatMap(() => Array.from({ length: 44 }, (_, shape) => shape));
  const result = grid(shapes, Uint16Array.from(shapes, (_, i) => Math.floor(i / 44)));
  const nbt = readNbt(encodeSchem(result, FAMILIES)).value;
  assert.equal(readVarInts(nbt.BlockData).length, shapes.length);
  for (const state of Object.keys(nbt.Palette)) {
    const [identifier, raw = ''] = state.replace(']', '').split('['), id = identifier.replace('minecraft:', '');
    assert.ok(states[id], id);
    const attributes: Record<string, string> = raw ? Object.fromEntries(raw.split(',').map(pair => pair.split('='))) : {};
    for (const [key, value] of Object.entries(attributes)) assert.ok(states[id][0][key]?.includes(value), `${state}: ${key}=${value}`);
  }
});

test('unsupported native variants use real near-color shapes without changing geometry; leaves are persistent', () => {
  for (const id of ['diamond_ore', 'glass', 'smooth_stone', 'oak_leaves']) {
    const family = FAMILIES.find(block => block.id === id)!;
    const result = grid([3, 1, 2, 9]), before = result.shapes.slice();
    const nbt = readNbt(encodeSchem(result, [family])).value;
    assert.deepEqual(result.shapes, before);
    const inverse = new Map(Object.entries(nbt.Palette).map(([state, index]) => [index as number, state]));
    const cells = readVarInts(nbt.BlockData).map(index => inverse.get(index)!);
    assert.ok(cells[0].startsWith(`minecraft:${id}`)); assert.match(cells[1], /_slab\[type=bottom/);
    assert.match(cells[2], /_slab\[type=top/); assert.match(cells[3], /_stairs\[facing=east,half=bottom,shape=straight/);
    if (id === 'oak_leaves') assert.match(cells[0], /persistent=true/);
  }
});

test('independent per-shape colors reach both the merged preview and falling instances', () => {
  const result = grid([3, 1, 2, 9]), before = result.shapes.slice();
  const colors: MaterialColors[] = [{ full: [255, 0, 0], slab: [0, 255, 0], stairs: [0, 0, 255] }];
  const surface = meshSurface(result, colors), falling = fallingBlocks(result, colors)!;
  const rgb = new Set<string>();
  for (let i = 0; i < surface.colors.length; i += 3) rgb.add(Array.from(surface.colors.subarray(i, i + 3)).join(','));
  assert.deepEqual(rgb, new Set(['1,0,0', '0,1,0', '0,0,1']));
  assert.deepEqual(Array.from(falling.colors), [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1]);
  assert.deepEqual(result.shapes, before);
  assert.equal(Object.keys(familyColors(FAMILIES[0])).length, 3);
});

test('solid-color automatic suggestions avoid glass, and exact copper ties prefer a waxed variant', () => {
  for (const material of [{ name: 'pale', color: [176, 214, 219] as [number, number, number] },
    { name: 'copper', color: FULL_BLOCKS.find(block => block.id === 'cut_copper')!.color }]) {
    const family = FAMILIES[suggestFamily(material)];
    assert.equal(FULL_BLOCKS.find(block => block.id === family.id)!.auto, true);
    if (material.name === 'copper') assert.ok(family.id.startsWith('waxed_'));
  }
});
