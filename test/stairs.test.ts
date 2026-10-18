import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Path, Shape } from 'three';
import { extractModel } from '../src/glb.ts';
import { voxelize } from '../src/voxelize.ts';
import { meshSurface } from '../src/surface.ts';
import { fallingBlocks } from '../src/falling-data.ts';
import { encodeSchem } from '../src/schem.ts';
import { BLOCK_SHAPES, SHAPE_MASKS } from '../src/block-shapes.ts';
import { FAMILIES } from '../src/palette.ts';
import { readNbt, readVarInts } from './nbt-reader.ts';
import type { VoxelResult } from '../src/types.ts';

function fixture(shapes: number[]): VoxelResult {
  return { size: { width: shapes.length, height: 1, length: 1, scale: 1 }, shapes: Uint8Array.from(shapes),
    materials: new Uint16Array(shapes.length), stats: { full: 0, bottom: 0, top: 0, stairs: 0, solids: 0, milliseconds: 0 } };
}

test('all eight straight stairs point their tall side toward the exported facing', () => {
  const expected = [0x3f, 0xaf, 0xcf, 0x5f, 0xf3, 0xfa, 0xfc, 0xf5];
  const straight = BLOCK_SHAPES.map((state, id) => ({ ...state, id })).filter(state => state.turn === 'straight');
  assert.deepEqual(straight.map(state => state.mask), expected);
  for (const state of straight) {
    const group = new Group(), material = new MeshStandardMaterial();
    // Build independent, closed half-size source cubes, plus a bounding anchor in the next cell.
    for (let bit = 0; bit < 8; bit++) if (state.mask & (1 << bit)) {
      const cube = new Mesh(new BoxGeometry(0.5, 0.5, 0.5), material);
      cube.position.set((bit & 1) / 2 + 0.25, (bit >> 2) / 2 + 0.25, ((bit >> 1) & 1) / 2 + 0.25); group.add(cube);
    }
    const anchor = new Mesh(new BoxGeometry(1, 1, 1), material); anchor.position.set(1.5, 0.5, 0.5); group.add(anchor);
    const converted = voxelize(extractModel(group), 2);
    assert.equal(SHAPE_MASKS[converted.shapes[0]], state.mask, `${state.facing}/${state.half}`);
  }
});

test('inner and outer corners use Minecraft left/right for both vertical halves', () => {
  const find = (half: string, turn: string) => BLOCK_SHAPES.find(state => state.facing === 'east' && state.half === half && state.turn === turn)!.mask;
  assert.equal(find('bottom', 'inner_left'), 0xbf); assert.equal(find('bottom', 'inner_right'), 0xef);
  assert.equal(find('bottom', 'outer_left'), 0x2f); assert.equal(find('bottom', 'outer_right'), 0x8f);
  assert.equal(find('top', 'inner_left'), 0xfb); assert.equal(find('top', 'outer_right'), 0xf8);
});

test('a diagonal floor opening stays open and its rim can use stairs', () => {
  const floor = new Shape(); floor.moveTo(0, 0); floor.lineTo(6, 0); floor.lineTo(6, 6); floor.lineTo(0, 6); floor.closePath();
  const opening = new Path(); opening.moveTo(3, 1.5); opening.lineTo(1.5, 3); opening.lineTo(3, 4.5); opening.lineTo(4.5, 3); opening.closePath();
  floor.holes.push(opening);
  const mesh = new Mesh(new ExtrudeGeometry(floor, { depth: 1, bevelEnabled: false }), new MeshStandardMaterial()); mesh.rotation.x = Math.PI / 2;
  const group = new Group(); group.add(mesh);
  const result = voxelize(extractModel(group), 6);
  assert.ok(result.stats.stairs > 0);
  for (const x of [2, 3]) for (const z of [2, 3]) assert.equal(result.shapes[x + z * 6], 0);
});

test('every stair preview has the exact volume and outward normals of its occupied subcells', () => {
  for (let shape = 4; shape < BLOCK_SHAPES.length; shape++) {
    const { positions, normals } = meshSurface(fixture([shape]), [[125, 125, 125]]);
    let volume = 0;
    for (let i = 0; i < positions.length; i += 9) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = positions.subarray(i, i + 9);
      volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
      const cross = [(by - ay) * (cz - az) - (bz - az) * (cy - ay), (bz - az) * (cx - ax) - (bx - ax) * (cz - az),
        (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)];
      assert.ok(cross.reduce((sum, n, axis) => sum + n * normals[i + axis], 0) > 0);
    }
    assert.ok(Math.abs(volume - SHAPE_MASKS[shape].toString(2).replaceAll('0', '').length / 8) < 1e-6);
  }
});

test('falling stair pieces share one block anchor and retain the exported volume', () => {
  const result = fixture([9]), data = fallingBlocks(result, [[125, 125, 125]])!;
  assert.equal(data.centers.length / 3, 2);
  assert.deepEqual(Array.from(data.anchors), [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
  let volume = 0;
  for (let i = 0; i < data.sizes.length; i += 3) volume += data.sizes[i] * data.sizes[i + 1] * data.sizes[i + 2];
  assert.equal(volume, 0.75); assert.equal(result.shapes[0], 9);
});

test('independent NBT reader recovers all 40 oriented stair states and explicit air', () => {
  const result = fixture(Array.from({ length: 44 }, (_, i) => i));
  const root = readNbt(encodeSchem(result, [FAMILIES[0]])).value;
  const states = new Map<number, string>(Object.entries(root.Palette).map(([state, id]) => [id as number, state]));
  const indices = readVarInts(root.BlockData);
  assert.equal(indices.length, 44); assert.equal(states.get(indices[0]), 'minecraft:air');
  const facings = ['north', 'east', 'south', 'west'], turns = ['straight', 'inner_left', 'inner_right', 'outer_left', 'outer_right'];
  for (let i = 4; i < 44; i++) {
    const local = i - 4, half = local < 20 ? 'bottom' : 'top', facing = facings[Math.floor(local / 5) % 4], turn = turns[local % 5];
    assert.equal(states.get(indices[i]), `minecraft:stone_stairs[facing=${facing},half=${half},shape=${turn},waterlogged=false]`);
  }
});
