import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { BoxGeometry, BufferGeometry, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Path, PlaneGeometry, Shape } from 'three';
import { extractModel } from '../src/glb.ts';
import { gridSize } from '../src/geometry.ts';
import { voxelize } from '../src/voxelize.ts';
import { meshSurface } from '../src/surface.ts';
import { encodeSchem, gzipSchem, DATA_VERSION } from '../src/schem.ts';
import { FAMILIES } from '../src/palette.ts';
import { fallingBlocks } from '../src/falling-data.ts';
import { readNbt, readVarInts } from './nbt-reader.ts';
import type { Vec3, VoxelResult } from '../src/types.ts';

function box(min: Vec3, max: Vec3, material = new MeshStandardMaterial()): Mesh {
  const mesh = new Mesh(new BoxGeometry(...max.map((v, i) => v - min[i]) as Vec3), material);
  mesh.position.set(...max.map((v, i) => (v + min[i]) / 2) as Vec3); return mesh;
}
function model(...objects: Mesh[]) { const group = new Group(); group.add(...objects); return extractModel(group); }
const at = (r: VoxelResult, x: number, y: number, z: number) => r.shapes[x + z * r.size.width + y * r.size.width * r.size.length];

test('normal seams reconstruct one closed cube and exact integer bounds', () => {
  const r = voxelize(model(box([0, 0, 0], [2, 2, 2])), 2);
  assert.deepEqual(r.size, { width: 2, height: 2, length: 2, scale: 1 });
  assert.equal(r.stats.full, 8); assert.equal(r.stats.solids, 1);
  const surface = meshSurface(r, [[125, 125, 125]]);
  assert.equal(surface.positions.length / 9, 12, 'greedy mesher emits six rectangular faces');
});

test('lower and upper slabs retain their vertical placement', () => {
  const anchor = box([1, 0, 0], [2, 1, 1]);
  assert.equal(at(voxelize(model(box([0, 0, 0], [1, 0.5, 1]), anchor), 2), 0, 0, 0), 1);
  assert.equal(at(voxelize(model(box([0, 0.5, 0], [1, 1, 1]), anchor), 2), 0, 0, 0), 2);
});

test('material primitive splits reconstruct a single closed logical part', () => {
  const source = new BoxGeometry(1, 1, 1), group = new Group();
  source.groups.forEach(g => {
    const geometry = new BufferGeometry(); geometry.setAttribute('position', source.getAttribute('position'));
    geometry.setIndex(Array.from(source.index!.array).slice(g.start, g.start + g.count));
    group.add(new Mesh(geometry, new MeshStandardMaterial()));
  });
  const r = voxelize(extractModel(group, () => group), 1);
  assert.equal(r.stats.full, 1); assert.equal(r.stats.solids, 1);
});

test('preview complexity fallback preserves all voxel data', () => {
  const r = voxelize(model(box([0, 0, 0], [1, 1, 1])), 1);
  const surface = meshSurface(r, [[100, 100, 100]], undefined, 1);
  assert.ok(surface.warning); assert.equal(surface.positions.length, 0); assert.equal(r.shapes[0], 3);
});

test('falling instances use actual full-block and slab centers without changing export geometry', () => {
  const r = voxelize(model(box([0, 0, 0], [1, 0.5, 1]), box([1, 0.5, 0], [2, 1, 1]), box([2, 0, 0], [3, 1, 1])), 3);
  const before = r.shapes.slice(), data = fallingBlocks(r, [[100, 100, 100], [120, 120, 120], [140, 140, 140]])!;
  assert.deepEqual(Array.from(data.centers), [0.5, 0.25, 0.5, 1.5, 0.75, 0.5, 2.5, 0.5, 0.5]);
  assert.deepEqual(Array.from(data.sizes), [1, 0.5, 1, 1, 0.5, 1, 1, 1, 1]);
  assert.deepEqual(r.shapes, before);
});

test('falling instances omit fully enclosed blocks and respect the animation memory budget', () => {
  const r = voxelize(model(box([0, 0, 0], [3, 3, 3])), 3);
  assert.equal(fallingBlocks(r, [[100, 100, 100]])!.centers.length / 3, 26);
  assert.equal(fallingBlocks(r, [[100, 100, 100]], 10), undefined);
  assert.equal(r.stats.full, 27);
});

test('intersecting solids form a union instead of XOR', () => {
  const r = voxelize(model(box([0, 0, 0], [2, 2, 2]), box([1, 0, 0], [3, 2, 2])), 3);
  assert.equal(r.stats.full, 12); assert.equal(at(r, 1, 1, 1), 3);
});

test('a connected closed mesh keeps a two-block through hole', () => {
  const outer = new Shape(); outer.moveTo(0, 0); outer.lineTo(4, 0); outer.lineTo(4, 4); outer.lineTo(0, 4); outer.closePath();
  const hole = new Path(); hole.moveTo(1, 1); hole.lineTo(1, 3); hole.lineTo(3, 3); hole.lineTo(3, 1); hole.closePath(); outer.holes.push(hole);
  const r = voxelize(model(new Mesh(new ExtrudeGeometry(outer, { depth: 1, bevelEnabled: false }), new MeshStandardMaterial())), 4);
  assert.equal(r.stats.full, 12); assert.equal(r.stats.solids, 1);
  for (const x of [1, 2]) for (const y of [1, 2]) assert.equal(at(r, x, y, 0), 0);
});

test('a half-block vertical gap stays empty', () => {
  const r = voxelize(model(box([0, 0, 0], [1, 0.5, 1]), box([0, 1, 0], [1, 1.5, 1]), box([1, 0, 0], [2, 1.5, 1])), 2);
  assert.equal(at(r, 0, 0, 0), 1); assert.equal(at(r, 0, 1, 0), 1);
});

test('node mirroring, rotation and source translations preserve scale and orientation', () => {
  const mesh = box([0, 0, 0], [2, 1, 1]); mesh.scale.x = -1; mesh.rotation.y = Math.PI / 2;
  const r = voxelize(model(mesh), 2);
  assert.equal(r.size.width, 1); assert.equal(r.size.length, 2); assert.equal(r.stats.full, 2);
});

test('slanted beams produce partial-height blocks', () => {
  const mesh = box([0, 0, 0], [4, 0.5, 1]); mesh.rotation.z = Math.atan(0.5);
  const r = voxelize(model(mesh), 4);
  assert.ok(r.stats.bottom + r.stats.top + r.stats.stairs > 0);
});

test('open meshes identify the offending part instead of silently filling it', () => {
  const plane = new Mesh(new PlaneGeometry(2, 2), new MeshStandardMaterial()); plane.name = 'Broken wall';
  assert.throws(() => voxelize(model(plane), 2), /Broken wall.*开口边/);
});

test('oversized grids reject before allocating voxel buffers', () => {
  assert.throws(() => gridSize(model(box([0, 0, 0], [1, 1, 1])), 512), /3200 万格/);
});

test('Sponge v2 gzip round-trips independently with air, upper slabs and XYZ indexing', async () => {
  const r = voxelize(model(box([0, 0.5, 0], [1, 1, 1]), box([1, 0, 1], [2, 1, 3])), 3);
  const decoded = readNbt(gunzipSync(await gzipSchem(r, r.stats.solids ? [FAMILIES[0], FAMILIES[1]] : [])));
  const nbt = decoded.value;
  assert.equal(decoded.name, 'Schematic'); assert.equal(nbt.Version, 2); assert.equal(nbt.DataVersion, DATA_VERSION);
  assert.deepEqual([nbt.Width, nbt.Height, nbt.Length], [r.size.width, r.size.height, r.size.length]);
  assert.deepEqual(nbt.Offset, [0, 0, 0]); assert.equal(nbt.Palette['minecraft:air'], 0);
  const inverse = Object.fromEntries(Object.entries(nbt.Palette).map(([state, id]) => [id as number, state]));
  const cells = readVarInts(nbt.BlockData);
  assert.equal(cells.length, r.shapes.length);
  cells.forEach((id, i) => {
    if (r.shapes[i] === 0) assert.equal(id, 0);
    if (r.shapes[i] === 2) assert.match(inverse[id], /type=top,waterlogged=false/);
  });
});

test('multi-byte palette varints work beyond 127 states', () => {
  const count = 260, families = Array.from({ length: count }, (_, i) => ({ ...FAMILIES[0], full: `minecraft:test_${i}` }));
  const result: VoxelResult = { size: { width: count, height: 1, length: 1, scale: 1 }, shapes: new Uint8Array(count).fill(3),
    materials: Uint16Array.from({ length: count }, (_, i) => i), stats: { full: count, bottom: 0, top: 0, stairs: 0, shelves: 0, solids: 0, milliseconds: 0 } };
  const nbt = readNbt(encodeSchem(result, families)).value;
  assert.equal(nbt.PaletteMax, count + 1);
  assert.deepEqual(readVarInts(nbt.BlockData), Array.from({ length: count }, (_, i) => i + 1));
});
