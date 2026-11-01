import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BuildingWorld, createBuilding, dirtyChunks } from '../src/core/building.ts';
import { meshBuildingChunk } from '../src/core/building-mesh.ts';
import { flattenBuilding } from '../src/core/building-export.ts';
import { pickBlock } from '../src/core/building-pick.ts';
import { FAMILIES } from '../src/core/palette.ts';
import { WalkingCollision } from '../src/core/walking.ts';
import type { VoxelResult } from '../src/core/types.ts';
import { executeBuildingCommand } from '../src/core/building-commands.ts';
import { defaultBrush, defaultPreset, defaultStructure, trimWallPattern, wallArea, WALL_LAYOUT_VERSION } from '../src/core/brush-types.ts';
import type { WallNode, WallPreset } from '../src/core/brush-types.ts';
import { supportColumn, wallColumns } from '../src/core/wall-layout.ts';
import type { StrokeRay } from '../src/core/surface-stroke.ts';
import { constrainWallPoint, wallHeading, wallTurn } from '../src/core/wall-guides.ts';

const stone = FAMILIES.find(family => family.id === 'stone')!;
function empty() { return new BuildingWorld(createBuilding('fixture', [stone], 'stone')); }
function slab(): VoxelResult {
  return { size: { width: 1, height: 1, length: 1, scale: 1 }, shapes: new Uint8Array([1]), materials: new Uint16Array([0]),
    stats: { full: 0, bottom: 1, top: 0, stairs: 0, shelves: 0, solids: 1, milliseconds: 0 } };
}
test('building chunks support negative cells and cull both sides of a chunk boundary', () => {
  const world = empty(); world.place([-1, 0, 0], 0); world.place([15, 0, 0], 0); world.place([16, 0, 0], 0);
  assert.equal(world.shapeAt(-1, 0, 0), 3); assert.equal(world.shapeAt(16, 0, 0), 3);
  assert.deepEqual(world.bounds, { min: [-1, 0, 0], max: [17, 1, 1] });
  assert.equal(meshBuildingChunk(world, '0,0,0').positions.length / 9, 10);
  assert.equal(meshBuildingChunk(world, '1,0,0').positions.length / 9, 10);
  assert.ok(dirtyChunks([16, 0, 0]).includes('0,0,0'));
});
test('undo and redo survive serialization, while a new placement discards the redo branch', () => {
  const world = empty(); world.place([0, 0, 0], 0); world.place([1, 0, 0], 0); world.undo();
  const restored = new BuildingWorld(structuredClone(world.document)); restored.redo();
  assert.equal(restored.count, 2); assert.equal(restored.shapeAt(1, 0, 0), 3);
  restored.undo(); restored.place([2, 0, 0], 0);
  assert.equal(restored.redo(), undefined); assert.equal(restored.shapeAt(1, 0, 0), 0);
  assert.equal(world.shapeAt(2, 0, 0), 0, 'restoration owns its own serialized chunks');
});
test('shrinking history prioritizes recent undo steps without changing blocks', () => {
  const world = empty(); for (let x = 0; x < 4; x++) world.place([x, 0, 0], 0);
  world.undo(); world.setLimit(2);
  assert.equal(world.count, 3); assert.equal(world.document.history.length, 2); assert.equal(world.document.cursor, 2);
  world.undo(); world.undo(); assert.equal(world.count, 1); assert.equal(world.undo(), undefined);
  assert.throws(() => world.setLimit(0)); assert.throws(() => world.setLimit(1.5));
});
test('invalid placements leave the world and operation history unchanged', () => {
  const world = empty(); world.place([0, 0, 0], 0); const revision = world.document.revision;
  for (const position of [[0, 0, 0], [0, -1, 0], [65535, 0, 0], [0.5, 0, 0]] as [number, number, number][]) assert.throws(() => world.place(position, 0));
  assert.equal(world.count, 1); assert.equal(world.document.revision, revision); assert.equal(world.document.history.length, 1);
});
test('the immutable import base retains slab shape, while export normalizes negative X', () => {
  const base = slab(), world = new BuildingWorld(createBuilding('fixture', [stone], 'stone', base));
  world.place([-1, 0, 0], 0); const result = flattenBuilding(world);
  assert.deepEqual([...result.shapes], [3, 1]); assert.equal(result.size.width, 2);
  assert.equal(result.stats.bottom, 1); assert.equal(result.stats.full, 1); assert.deepEqual([...base.shapes], [1]);
  world.undo(); assert.equal(world.shapeAt(0, 0, 0), 1); assert.deepEqual([...base.shapes], [1]);
});
test('ray picking uses exact partial surfaces and collision includes newly placed negative cells', () => {
  const world = new BuildingWorld(createBuilding('fixture', [stone], 'stone', slab()));
  const hit = pickBlock(world, [0.5, 2, 0.5], [0, -1, 0], 10)!;
  assert.deepEqual(hit.position, [0, 0, 0]); assert.deepEqual(hit.normal, [0, 1, 0]); assert.equal(hit.point[1], 0.5);
  world.place([-1, 0, 0], 0); const collision = new WalkingCollision(); collision.setWorld(world);
  assert.equal(collision.grounded([-0.5, 1, 0.5]), true);
});

test('a hollow fixed box is one undo step and preserves already occupied cells', () => {
  const world = empty(); world.place([0, 0, 0], 0);
  const settings = { ...defaultBrush(), kind: 'box' as const, fixed: true, size: [3, 3, 3] as [number, number, number], hollow: true };
  executeBuildingCommand(world, { type: 'brush', settings, a: [0, 0, 0], selected: 'stone' });
  assert.equal(world.count, 26); assert.equal(world.shapeAt(1, 1, 1), 0); assert.equal(world.document.history.length, 2);
  executeBuildingCommand(world, { type: 'undo' }); assert.equal(world.count, 1);
  executeBuildingCommand(world, { type: 'redo' }); assert.equal(world.count, 26);
});
test('flexible shapes use opposite corners or center/radius, and reject underground spheres atomically', () => {
  const world = empty(), settings = { ...defaultBrush(), kind: 'box' as const };
  executeBuildingCommand(world, { type: 'brush', settings, a: [-2, 0, -1], b: [0, 2, 1], selected: 'stone' });
  assert.equal(world.count, 27); assert.equal(world.shapeAt(-1, 1, 0), 3);
  const revision = world.document.revision;
  assert.throws(() => executeBuildingCommand(world, { type: 'brush', settings: { ...settings, kind: 'sphere', fixed: true, radius: 4 }, a: [8, 0, 0], selected: 'stone' }));
  assert.equal(world.count, 27); assert.equal(world.document.revision, revision);
});
test('wall instances share live presets, independent copies isolate edits, and deltas reproduce the worker world', () => {
  const worker = empty(), main = empty(), preset = defaultPreset('wall');
  const run = (command: Parameters<typeof executeBuildingCommand>[1]) => { const delta = executeBuildingCommand(worker, command); if (delta) main.accept(structuredClone(delta)); };
  run({ type: 'preset', preset });
  const first: WallNode = { id: 'a', name: 'a', preset: 'wall', points: [{ position: [-4, 0, 0] }, { position: [4, 0, 0] }], closed: false, inside: true, outside: true };
  run({ type: 'node', node: first }); run({ type: 'node', node: { ...first, id: 'b', points: [{ position: [-4, 0, 8] }, { position: [4, 0, 8] }] } });
  run({ type: 'preset', preset: { ...preset, structures: preset.structures.map(item => item.kind === 'wall' ? { ...item, pattern: { width: 1, height: 1, cells: ['stone'] } } : item) } });
  assert.equal(main.shapeAt(0, 3, 0), 0); assert.equal(main.shapeAt(0, 3, 8), 0);
  run({ type: 'preset', preset: { ...preset, id: 'copy' } }); run({ type: 'node', node: { ...first, preset: 'copy' } });
  assert.equal(main.shapeAt(0, 3, 0), 3); assert.equal(main.shapeAt(0, 3, 8), 0);
  run({ type: 'undo' }); assert.equal(main.shapeAt(0, 3, 0), 0);
  assert.equal(main.count, worker.count); assert.deepEqual(flattenBuilding(main).shapes, flattenBuilding(worker).shapes);
});
test('inside/outside is withheld for open, degenerate or self-intersecting outlines', () => {
  const node: WallNode = { id: 'a', name: 'a', preset: 'wall', points: [[0, 0, 0], [5, 0, 0], [5, 0, 5], [0, 0, 5]].map(position => ({ position: position as [number, number, number] })), closed: true, inside: true, outside: true };
  assert.ok(wallArea(node) > 0); assert.equal(wallArea({ ...node, closed: false }), 0);
  assert.equal(wallArea({ ...node, points: [node.points[0], node.points[2], node.points[1], node.points[3]] }), 0);
});
test('terrain cracks erase the immutable base through overrides, survive serialization, and undo as one action', () => {
  const base: VoxelResult = { size: { width: 24, height: 8, length: 24, scale: 1 }, shapes: new Uint8Array(24 * 8 * 24).fill(3), materials: new Uint16Array(24 * 8 * 24),
    stats: { full: 24 * 8 * 24, bottom: 0, top: 0, stairs: 0, shelves: 0, solids: 24 * 8 * 24, milliseconds: 0 } };
  const world = new BuildingWorld(createBuilding('cracks', [stone], 'stone', base)), before = world.count;
  const command = { type: 'brush' as const, settings: { ...defaultBrush(), kind: 'fracture' as const }, a: [12, 7, 12] as [number, number, number], selected: 'stone' };
  executeBuildingCommand(world, command); assert.ok(world.count < before); const carved = world.count;
  const restored = new BuildingWorld(structuredClone(world.document)); executeBuildingCommand(restored, command); assert.equal(restored.count, carved);
  executeBuildingCommand(restored, { type: 'undo' }); assert.equal(restored.count, before);
  assert.ok(base.shapes.every(shape => shape === 3)); assert.ok(flattenBuilding(world).shapes.every(shape => shape <= 47));
});

test('continuous brush deltas merge into one persisted undo action on both threads', () => {
  const worker = empty(), main = empty();
  for (const x of [-1, 0, 16]) {
    const delta = executeBuildingCommand(worker, { type: 'brush', settings: defaultBrush(), a: [x, 0, 0], selected: 'stone', stroke: 'gesture-a' })!;
    main.accept(structuredClone(delta));
  }
  assert.equal(main.document.history.length, 1); assert.equal(worker.document.history.length, 1); assert.equal(main.count, 3);
  const restored = new BuildingWorld(structuredClone(main.document));
  executeBuildingCommand(restored, { type: 'undo' }); assert.equal(restored.count, 0);
  executeBuildingCommand(restored, { type: 'redo' }); assert.equal(restored.count, 3);
  executeBuildingCommand(restored, { type: 'undo' });
  executeBuildingCommand(restored, { type: 'brush', settings: defaultBrush(), a: [2, 0, 0], selected: 'stone', stroke: 'gesture-b' });
  assert.equal(restored.document.history.length, 1); assert.equal(restored.document.cursor, 1); assert.equal(restored.redo(), undefined);
});

test('open walls generate supports on both sides and multiple stations own their thickness', () => {
  const world = empty(), preset = defaultPreset('wall');
  preset.structures[1] = { ...preset.structures[1], enabled: true, every: 1, offset: 0, thickness: 3 };
  preset.structures[2] = { ...preset.structures[2], enabled: true, every: 4, thickness: 2 };
  preset.structures.push({ ...defaultStructure('extra', 'station'), every: 1, offset: 0, thickness: 5, pattern: { width: 1, height: 6, cells: Array(6).fill('stone') } });
  executeBuildingCommand(world, { type: 'preset', preset });
  executeBuildingCommand(world, { type: 'node', node: { id: 'wall-a', name: 'a', preset: preset.id, closed: false, inside: false, outside: false, points: [{ position: [0, 0, 0] }, { position: [8, 0, 0] }] } });
  assert.equal(world.shapeAt(0, 0, -2), 3); assert.equal(world.shapeAt(0, 0, 2), 3);
  assert.equal(world.shapeAt(3, 4, 1), 3); assert.equal(world.shapeAt(4, 5, 2), 3);
  executeBuildingCommand(world, { type: 'undo' }); assert.equal(world.count, 0);
});

function downRay(x: number, z = 0.5): StrokeRay { return { origin: [x, 20, z], direction: [0, -1, 0], pixel: [x * 20, z * 20], far: 100 }; }

test('wall previews show a horizontal angle and independently apply height and angle constraints', () => {
  const points = [{ position: [0, 2, 0] as [number, number, number] }], target: [number, number, number] = [6, 8, 4];
  assert.equal(wallTurn(points, [4, 99, 4]), 45);
  assert.deepEqual(constrainWallPoint(points, target, false, true), [5, 8, 5]);
  assert.deepEqual(constrainWallPoint(points, target, true, false), [6, 2, 4]);
  assert.deepEqual(constrainWallPoint(points, target, true, true), [5, 2, 5]);
  assert.deepEqual(target, [6, 8, 4]); assert.equal(wallTurn(points, points[0].position), undefined);
  assert.equal(wallTurn([], target), undefined); assert.notEqual(constrainWallPoint([], target, true, true), target);
});

test('wall angle snapping is relative to the preceding segment rather than world X', () => {
  const points = [{ position: [0, 0, 0] as [number, number, number] }, { position: [0, 0, 5] as [number, number, number] }];
  assert.equal(wallTurn(points, [4, 0, 9]), -45);
  assert.deepEqual(constrainWallPoint(points, [4, 7, 10], false, true), [5, 7, 10]);
  assert.equal(wallTurn(points, [5, 7, 10]), -45);
});

test('wall angle references use a curve end tangent and skip vertical-only segments', () => {
  const curve = [{ position: [0, 0, 0] as [number, number, number] }, { position: [4, 3, 5] as [number, number, number], control: [2, 1, 5] as [number, number, number] }];
  assert.equal(wallHeading(curve), 0); assert.equal(wallTurn(curve, [4, 8, 9]), 90);
  assert.equal(wallHeading([{ position: [0, 0, 0] }, { position: [4, 3, 5], control: [4, 3, 5] }]), Math.atan2(5, 4));
  const vertical = [{ position: [0, 0, 0] as [number, number, number] }, { position: [0, 0, 5] as [number, number, number] }, { position: [0, 8, 5] as [number, number, number] }];
  assert.equal(wallHeading(vertical), Math.PI / 2); assert.equal(wallTurn(vertical, [4, 8, 5]), -90);
});
test('surface strokes ignore their own blocks while a later stroke can build the next layer', () => {
  const world = empty();
  executeBuildingCommand(world, { type: 'stroke', stroke: 'first', selected: 'stone', rays: [downRay(0.5)] });
  executeBuildingCommand(world, { type: 'stroke', stroke: 'first', selected: 'stone', rays: [downRay(0.5)], end: true });
  assert.equal(world.count, 1); assert.equal(world.shapeAt(0, 1, 0), 0);
  executeBuildingCommand(world, { type: 'stroke', stroke: 'next', selected: 'stone', rays: [downRay(0.5)], end: true });
  assert.equal(world.count, 2); assert.equal(world.shapeAt(0, 1, 0), 3);
});
test('sparse and dense input draw the same unbroken surface line and preserve one undo step', () => {
  const sparse = empty(), dense = empty();
  executeBuildingCommand(sparse, { type: 'stroke', stroke: 'a', selected: 'stone', rays: [downRay(0.2, 2.2), downRay(20.2, 2.2)], end: true });
  for (let i = 0; i <= 20; i++) executeBuildingCommand(dense, { type: 'stroke', stroke: 'b', selected: 'stone', rays: [downRay(0.2 + i, 2.2)], end: i === 20 });
  assert.equal(sparse.count, 21); assert.deepEqual(flattenBuilding(sparse).shapes, flattenBuilding(dense).shapes);
  for (let x = 0; x <= 20; x++) { assert.equal(sparse.shapeAt(x, 0, 2), 3); assert.equal(sparse.shapeAt(x, 1, 2), 0); }
  const restored = new BuildingWorld(structuredClone(sparse.document)); restored.undo(); assert.equal(restored.count, 0); restored.redo(); assert.equal(restored.count, 21);
});
test('a surface stroke follows the original stepped curve without stacking on its new surface', () => {
  const heights = [0, 1, 2, 3, 3, 2, 1, 0], base: VoxelResult = { size: { width: 8, height: 4, length: 1, scale: 1 }, shapes: new Uint8Array(32), materials: new Uint16Array(32),
    stats: { full: 0, bottom: 0, top: 0, stairs: 0, shelves: 0, solids: 0, milliseconds: 0 } };
  for (let x = 0; x < 8; x++) for (let y = 0; y <= heights[x]; y++) { base.shapes[x + y * 8] = 3; base.stats.full++; }
  base.stats.solids = base.stats.full; const before = [...base.shapes], world = new BuildingWorld(createBuilding('curve', [stone], 'stone', base));
  executeBuildingCommand(world, { type: 'stroke', stroke: 'curve', selected: 'stone', rays: [downRay(0.5), downRay(7.5)] });
  executeBuildingCommand(world, { type: 'stroke', stroke: 'curve', selected: 'stone', rays: [downRay(3.5)], end: true });
  for (let x = 0; x < 8; x++) assert.equal(world.shapeAt(x, heights[x] + 1, 0), 3);
  assert.equal(world.shapeAt(3, 5, 0), 0); assert.deepEqual([...base.shapes], before);
});
test('stations extend complete wall cycles and multiple stations keep form order', () => {
  const wall = defaultStructure('wall', 'wall'), station = defaultStructure('station', 'station');
  const layout = wallColumns([wall, station]);
  assert.deepEqual(Array.from({ length: 8 }, (_, column) => layout(column).station?.id ?? 'wall'), ['wall', 'wall', 'wall', 'station', 'wall', 'wall', 'wall', 'station']);
  const everyTwo = wallColumns([wall, { ...station, every: 2 }]); assert.equal(everyTwo(5).station, undefined); assert.equal(everyTwo(6).station?.id, 'station');
  const multiple = wallColumns([wall, station, { ...station, id: 'second' }]); assert.equal(multiple(3).station?.id, 'station'); assert.equal(multiple(4).station?.id, 'second');
});
test('support columns are centered with the even extra column toward path direction', () => {
  const support = { ...defaultStructure('support', 'support'), every: 8, offset: 4, pattern: { width: 4, height: 1, cells: Array(4).fill('stone') } };
  assert.deepEqual([3, 4, 5, 6].map(column => supportColumn(column, support)), [0, 1, 2, 3]);
  assert.ok(supportColumn(2, support) >= 4); assert.ok(supportColumn(7, support) >= 4);
});
test('old procedural caches refresh without adding an undo operation', () => {
  const doc = createBuilding('old-layout', [stone], 'stone'), preset = defaultPreset('wall'); preset.structures[1].enabled = true;
  doc.presets = [preset]; doc.nodes = [{ id: 'a', name: 'a', preset: 'wall', closed: false, inside: true, outside: true, points: [{ position: [0, 0, 0] }, { position: [7, 0, 0] }] }];
  delete doc.wallLayoutVersion; const worker = new BuildingWorld(doc), main = new BuildingWorld(structuredClone(doc));
  const delta = executeBuildingCommand(worker, { type: 'refresh' })!; main.accept(structuredClone(delta));
  assert.equal(delta.action, undefined); assert.equal(main.document.history.length, 0); assert.equal(main.document.wallLayoutVersion, WALL_LAYOUT_VERSION);
  assert.equal(main.count, worker.count); assert.equal(main.shapeAt(3, 4, 0), 3); assert.equal(executeBuildingCommand(worker, { type: 'refresh' }), undefined);
});

test('erasing trims only empty pattern borders and retains internal air', () => {
  const pattern = { width: 5, height: 5, cells: Array<string | null>(25).fill(null) };
  pattern.cells[1 + 1 * 5] = 'stone'; pattern.cells[3 + 1 * 5] = 'stone_bricks';
  pattern.cells[1 + 3 * 5] = 'cobblestone'; pattern.cells[3 + 3 * 5] = 'stone';
  assert.deepEqual(trimWallPattern(pattern), { width: 3, height: 3, cells: ['stone', null, 'stone_bricks', null, null, null, 'cobblestone', null, 'stone'] });
  assert.equal(pattern.width, 5); assert.equal(pattern.cells.length, 25);
  assert.deepEqual(trimWallPattern({ width: 4, height: 3, cells: Array(12).fill(null) }), { width: 1, height: 1, cells: [null] });
});

test('asymmetric support patterns keep exactly three columns in both directions on X and Z', () => {
  const pattern = { width: 3, height: 3, cells: ['stone', 'stone_bricks', 'stone_bricks', 'stone', 'cobblestone', 'stone', 'stone', 'stone_bricks', 'stone'] };
  for (const direction of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const world = empty(), support = { ...defaultStructure('support', 'support'), thickness: 1, every: 5, offset: 3, pattern };
    const preset = { id: 'support-only', name: 'support-only', structures: [support] }, start: [number, number, number] = [-4, 0, -7];
    executeBuildingCommand(world, { type: 'preset', preset });
    executeBuildingCommand(world, { type: 'node', node: { id: 'a', name: 'a', preset: preset.id, closed: false, inside: true, outside: true,
      points: [{ position: start }, { position: [start[0] + direction[0] * 10, 0, start[2] + direction[1] * 10] }] } });
    assert.equal(world.count, 36);
    for (let step = 0; step <= 10; step++) for (const side of [-1, 1]) for (let row = 0; row < 3; row++) {
      const x = start[0] + step * direction[0] - side * direction[1], z = start[2] + step * direction[1] + side * direction[0];
      const col = supportColumn(step, support);
      assert.equal(world.shapeAt(x, row, z), col < 3 ? 3 : 0, `direction ${direction}, step ${step}, row ${row}`);
      if (col < 3) assert.equal(world.document.families[world.materialAt(x, row, z)].id, pattern.cells[col + row * 3]);
    }
  }
});

test('version 2 wall caches upgrade to the current sampler without changing history', () => {
  const world = empty(); world.document.wallLayoutVersion = 2;
  const delta = executeBuildingCommand(world, { type: 'refresh' })!;
  assert.equal(delta.wallLayoutVersion, WALL_LAYOUT_VERSION); assert.equal(world.document.history.length, 0);
  assert.equal(delta.action, undefined); assert.equal(executeBuildingCommand(world, { type: 'refresh' }), undefined);
});

test('legacy wall presets and historical snapshots migrate to independent structure forms', () => {
  const old = { id: 'legacy', name: '旧墙', pattern: { width: 1, height: 2, cells: ['stone', 'stone'] }, thickness: 3, hollow: true,
    station: { width: 1, height: 3, cells: Array(3).fill('stone') }, stationEvery: 5, stationEnabled: true,
    support: { width: 1, height: 1, cells: ['stone'] }, supportEvery: 7, supportDepth: 4, supportEnabled: true } as unknown as WallPreset;
  const doc = createBuilding('fixture', [stone], 'stone'); doc.presets = [old];
  doc.history = [{ label: '旧预设', changes: [], presets: { before: [], after: [structuredClone(old)] } }]; doc.cursor = 1;
  new BuildingWorld(doc);
  assert.deepEqual(doc.presets[0].structures.map(item => item.thickness), [3, 3, 4]);
  assert.equal(doc.history[0].presets!.after[0].structures[2].every, 7);
  assert.equal(doc.presets[0].id, 'legacy'); assert.equal(doc.cursor, 1);
});
