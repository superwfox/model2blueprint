import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { extractModel } from '../src/glb.ts';
import { voxelize } from '../src/voxelize.ts';
import { meshSurface } from '../src/surface.ts';
import { fallingBlocks } from '../src/falling-data.ts';
import { SHAPE_BOXES, shapeContains } from '../src/block-shapes.ts';
import { encodeSchem } from '../src/schem.ts';
import { FAMILIES } from '../src/palette.ts';
import { readNbt, readVarInts } from './nbt-reader.ts';
import type { VoxelResult } from '../src/types.ts';

function fixture(shapes: number[]): VoxelResult {
  return { size: { width: 1, length: shapes.length, height: 1, scale: 1 }, shapes: Uint8Array.from(shapes), materials: new Uint16Array(shapes.length),
    stats: { full: 0, bottom: 0, top: 0, stairs: 0, shelves: 0, solids: 0, milliseconds: 0 } };
}
test('all four real shelf profiles fit their source including the thin back and quarter-height lips', () => {
  for (let direction = 0; direction < 4; direction++) {
    const group = new Group(), shelf = new Group(), material = new MeshStandardMaterial();
    for (const [x, y, z, sx, sy, sz] of [[0.5, 0.5, 29 / 32, 1, 1, 3 / 16], [0.5, 1 / 8, 3 / 4, 1, 1 / 4, 1 / 8], [0.5, 7 / 8, 3 / 4, 1, 1 / 4, 1 / 8]]) {
      const mesh = new Mesh(new BoxGeometry(sx, sy, sz), material); mesh.position.set(x - 0.5, y - 0.5, z - 0.5); shelf.add(mesh);
    }
    shelf.rotation.y = -direction * Math.PI / 2; shelf.position.set(1.5, 0.5, 1.5); group.add(shelf);
    for (const [x, z] of [[2.5, 0.5], [0.5, 2.5]]) { const anchor = new Mesh(new BoxGeometry(1, 1, 1), material); anchor.position.set(x, 0.5, z); group.add(anchor); }
    const result = voxelize(extractModel(group), 3);
    assert.equal(result.shapes[4], 44 + direction); assert.equal(result.stats.shelves, 1);
    assert.equal(result.shapes[0], 0); // The space in front of the shelf stays empty.
  }
});
test('a continuous vertical half-depth face prefers a shelf over repeated stairs', () => {
  const group = new Group(), material = new MeshStandardMaterial();
  const wall = new Mesh(new BoxGeometry(1, 3, 0.5), material); wall.position.set(0.5, 1.5, 0.75); group.add(wall);
  const anchor = new Mesh(new BoxGeometry(1, 1, 1), material); anchor.position.set(1.5, 0.5, 0.5); group.add(anchor);
  const result = voxelize(extractModel(group), 2);
  assert.deepEqual([0, 2, 4].map(id => result.shapes[id]), [44, 44, 44]);
  assert.equal(result.stats.stairs, 0); assert.equal(result.stats.shelves, 3);
});
test('shelf previews have exact volume, outward normals and no internal face against a neighbouring full block', () => {
  for (const shapes of [[44], [45], [46], [47], [44, 3]]) {
    const surface = meshSurface(fixture(shapes), [[125, 125, 125]]);
    let volume = 0, area = 0;
    for (let i = 0; i < surface.positions.length; i += 9) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = surface.positions.subarray(i, i + 9);
      const cross = [(by - ay) * (cz - az) - (bz - az) * (cy - ay), (bz - az) * (cx - ax) - (bx - ax) * (cz - az), (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)];
      assert.ok(cross.reduce((sum, c, axis) => sum + c * surface.normals[i + axis], 0) > 0);
      area += Math.hypot(...cross) / 2;
      volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
    }
    assert.ok(Math.abs(volume - (shapes.length === 1 ? 0.25 : 1.25)) < 1e-6);
    assert.ok(Math.abs(area - (shapes.length === 1 ? 3.375 : 7.375)) < 1e-6);
  }
  assert.equal(shapeContains(44, 0.5, 0.5, 0.75), false);
  assert.equal(shapeContains(44, 0.5, 0.125, 0.75), true);
  assert.equal(shapeContains(44, 0.5, 0.5, 0.9), true);
});
test('shelf animation uses three accurate boxes with one anchor and the separately selected shelf colour', () => {
  const result = fixture([44]), colors = [{ full: [255, 0, 0] as [number, number, number], slab: [255, 0, 0] as [number, number, number], stairs: [255, 0, 0] as [number, number, number], shelf: [0, 255, 0] as [number, number, number] }];
  const data = fallingBlocks(result, colors)!;
  assert.equal(data.sizes.length, 9); assert.equal(SHAPE_BOXES[44].length, 3);
  assert.deepEqual(Array.from(data.anchors), Array(3).fill([0.5, 0.5, 0.5]).flat());
  assert.deepEqual(Array.from(data.colors), Array(3).fill([0, 1, 0]).flat());
  const surface = meshSurface(result, colors);
  for (let i = 0; i < surface.colors.length; i += 3) assert.deepEqual(Array.from(surface.colors.subarray(i, i + 3)), [0, 1, 0]);
});
test('independent schem decoding preserves shelf facing and safe empty unpowered states', () => {
  const nbt = readNbt(encodeSchem(fixture([44, 45, 46, 47]), [FAMILIES[0]])).value;
  const palette = new Map(Object.entries(nbt.Palette).map(([state, id]) => [id, state]));
  const actual = readVarInts(nbt.BlockData).map(id => palette.get(id));
  assert.deepEqual(actual, ['north', 'east', 'south', 'west'].map(facing => `${FAMILIES[0].shelf}[facing=${facing},powered=false,side_chain=unconnected,waterlogged=false]`));
  assert.deepEqual(nbt.BlockEntities, []);
});
