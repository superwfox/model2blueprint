import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { loadGlb, disposeModel } from '../src/glb.ts';
import { voxelize } from '../src/voxelize.ts';
import { meshSurface } from '../src/surface.ts';
import { FAMILIES, suggestFamily } from '../src/palette.ts';
import { gzipSchem } from '../src/schem.ts';
import { familyColors } from '../src/colors.ts';
import { readNbt, readVarInts } from '../test/nbt-reader.ts';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node --experimental-strip-types scripts/verify-model.ts input.glb output.schem');
const bytes = await readFile(input);
const { model, scene } = await loadGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
console.log(JSON.stringify({ parts: model.parts.length, triangles: model.triangleCount, materials: model.materials.length, min: model.min, max: model.max }));
let last = 0;
const result = voxelize(model, 256, (p, message) => { if (p - last > 0.1) { console.log(`${Math.round(p * 100)}% ${message}`); last = p; } });
const families = model.materials.map(m => FAMILIES[suggestFamily(m)]);
const surface = meshSurface(result, families.map(familyColors));
const schem = await gzipSchem(result, families);
await writeFile(output, schem);
const root = readNbt(gunzipSync(schem)), cells = readVarInts(root.value.BlockData);
const inverse = new Map<number, string>(Object.entries(root.value.Palette).map(([k, v]) => [v as number, k]));
let air = 0, bottom = 0, top = 0, full = 0, stairs = 0, shelves = 0;
cells.forEach((id, i) => {
  const state = inverse.get(id);
  if (!state) throw new Error(`Missing palette entry at ${i}`);
  if (state === 'minecraft:air') air++;
  else if (state.includes('type=bottom')) bottom++;
  else if (state.includes('type=top')) top++;
  else if (state.includes('_stairs[')) stairs++;
  else if (state.includes('_shelf[')) shelves++;
  else full++;
  let shape = state === 'minecraft:air' ? 0 : state.includes('type=bottom') ? 1 : state.includes('type=top') ? 2 : 3;
  if (state.includes('_shelf[')) {
    const properties = Object.fromEntries(state.slice(state.indexOf('[') + 1, -1).split(',').map(entry => entry.split('=')));
    const facing = ['north', 'east', 'south', 'west'].indexOf(properties.facing);
    if (facing < 0 || properties.powered !== 'false' || properties.side_chain !== 'unconnected' || properties.waterlogged !== 'false') throw new Error(`Invalid shelf state ${state}`);
    shape = 44 + facing;
    if (!state.startsWith(`${families[result.materials[i]].shelf}[`)) throw new Error(`Shelf material mismatch at ${i}`);
  }
  if (state.includes('_stairs[')) {
    const properties = Object.fromEntries(state.slice(state.indexOf('[') + 1, -1).split(',').map(entry => entry.split('=')));
    const facing = ['north', 'east', 'south', 'west'].indexOf(properties.facing);
    const turn = ['straight', 'inner_left', 'inner_right', 'outer_left', 'outer_right'].indexOf(properties.shape);
    if (facing < 0 || turn < 0 || !['bottom', 'top'].includes(properties.half) || properties.waterlogged !== 'false') throw new Error(`Invalid stair state ${state}`);
    shape = 4 + (properties.half === 'top' ? 20 : 0) + facing * 5 + turn;
    if (!state.startsWith(`${families[result.materials[i]].stairs}[`)) throw new Error(`Stair material mismatch at ${i}`);
  }
  if (shape !== result.shapes[i]) throw new Error(`Block order/shape mismatch at ${i}`);
  if (shape === 3 && state !== families[result.materials[i]].full) throw new Error(`Full block material mismatch at ${i}`);
  if ((shape === 1 || shape === 2) && !state.startsWith(`${families[result.materials[i]].slab}[`)) throw new Error(`Slab material mismatch at ${i}`);
});
const report = { source: input, size: result.size, stats: result.stats, independentlyDecoded: { air, bottom, top, full, stairs, shelves },
  outputBytes: schem.length, previewTriangles: surface.positions.length / 9,
  palette: families.map((f, i) => ({ material: model.materials[i].name, family: f.id, full: f.full, slab: f.slab, stairs: f.stairs, shelf: f.shelf })),
  axiomImport: 'Not verified in the game; requires Minecraft 26.3 + Axiom import.' };
await writeFile(`${output}.report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2)); disposeModel(scene);
