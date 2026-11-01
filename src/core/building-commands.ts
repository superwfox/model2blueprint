import { BuildingWorld } from './building.ts';
import { FAMILIES } from './palette.ts';
import { MAX_BRUSH_CELLS, validPoint, WALL_LAYOUT_VERSION } from './brush-types.ts';
import { generateWalls, validateNode, validatePreset } from './walls.ts';
import type { WallCacheEntry } from './walls.ts';
import { smoothChanges, fractureChanges } from './terrain-brushes.ts';
import type { BuildingAction, BuildingDelta, CellChange, CellPatch, ChunkWrite } from './building.ts';
import type { BrushSettings, WallNode, WallPreset } from './brush-types.ts';
import type { Vec3 } from './types.ts';
import { SurfaceStroke } from './surface-stroke.ts';
import type { StrokeRay } from './surface-stroke.ts';

export type BuildingCommand =
  | { type: 'brush'; settings: BrushSettings; a: Vec3; b?: Vec3; selected: string; stroke?: string }
  | { type: 'stroke'; stroke: string; rays: StrokeRay[]; selected: string; end?: boolean }
  | { type: 'refresh' }
  | { type: 'node'; node?: WallNode; remove?: string }
  | { type: 'preset'; preset: WallPreset }
  | { type: 'undo' | 'redo' } | { type: 'limit'; value: number } | { type: 'select'; id: string };
const wallCaches = new WeakMap<BuildingWorld, Map<string, WallCacheEntry>>();
const strokePainters = new WeakMap<BuildingWorld, { id: string; painter: SurfaceStroke }>();
function shapeCells(settings: BrushSettings, a: Vec3, b?: Vec3): Vec3[] {
  const cells: Vec3[] = [], box = settings.kind === 'box';
  const radius = settings.fixed ? settings.radius : b ? Math.hypot(...a.map((value, axis) => value - b[axis])) : 0;
  if (!box && (!Number.isFinite(radius) || radius < 1)) throw new Error('球体半径至少为 1 格。');
  const min = box ? settings.fixed ? a : a.map((value, axis) => Math.min(value, b![axis])) as Vec3
    : a.map(value => Math.floor(value - radius)) as Vec3;
  const max = box ? settings.fixed ? a.map((value, axis) => value + settings.size[axis] - 1) as Vec3
    : a.map((value, axis) => Math.max(value, b![axis])) as Vec3 : a.map(value => Math.ceil(value + radius)) as Vec3;
  const volume = max.reduce((value, coordinate, axis) => value * (coordinate - min[axis] + 1), 1);
  if (!Number.isSafeInteger(volume) || volume < 1 || volume > MAX_BRUSH_CELLS) throw new Error('单次笔刷范围最多 262,144 格，请减小尺寸。');
  if (!validPoint(min) || !validPoint(max)) throw new Error('笔刷不能越过地面或无效坐标。');
  for (let y = min[1]; y <= max[1]; y++) for (let z = min[2]; z <= max[2]; z++) for (let x = min[0]; x <= max[0]; x++) {
    const p: Vec3 = [x, y, z], distance = Math.hypot(x - a[0], y - a[1], z - a[2]);
    if (box ? settings.hollow && p.every((value, axis) => value !== min[axis] && value !== max[axis])
      : distance > radius + 1e-7 || settings.hollow && distance <= radius - 1) continue;
    cells.push(p);
  }
  return cells;
}
function generatedDiff(world: BuildingWorld): ChunkWrite[] {
  let cache = wallCaches.get(world); if (!cache) { cache = new Map(); wallCaches.set(world, cache); }
  let generated;
  try { generated = generateWalls(world.document, cache); } catch (reason) { cache.clear(); throw reason; }
  const keys = new Set([...world.document.generated.keys(), ...generated.keys()]), writes: ChunkWrite[] = [];
  const range: Vec3[] = [];
  for (const chunk of generated.values()) range.push(chunk.bounds.min, chunk.bounds.max.map(value => value - 1) as Vec3);
  if (range.length) { const error = world.rangeError(range); if (error) { cache.clear(); throw new Error(error); } }
  for (const key of keys) {
    const a = world.document.generated.get(key), b = generated.get(key);
    if (a && b && a.count === b.count && a.shapes.every((value, i) => value === b.shapes[i] && a.materials[i] === b.materials[i])) continue;
    writes.push({ key, chunk: b });
  }
  return writes;
}
export function executeBuildingCommand(world: BuildingWorld, command: BuildingCommand): BuildingDelta | undefined {
  const doc = world.document; let patches: CellPatch[] = [], generated: ChunkWrite[] = [], action: BuildingAction | undefined;
  let selected = 0;
  if (command.type === 'stroke') {
    if (typeof command.stroke !== 'string' || !command.stroke || command.stroke.length > 128) throw new Error('连续绘制标识无效。');
    let entry = strokePainters.get(world);
    if (entry?.id !== command.stroke) { entry = { id: command.stroke, painter: new SurfaceStroke(world) }; strokePainters.set(world, entry); }
    try {
      const positions = entry.painter.trace(command.rays).filter(position => !world.shapeAt(...position));
      if (!positions.length) return;
      const error = world.rangeError(positions); if (error) throw new Error(error);
      const family = FAMILIES.find(value => value.id === command.selected); if (!family) throw new Error('所选方块无效。');
      selected = doc.families.findIndex(value => value.full === family.full); if (selected < 0) { selected = doc.families.length; doc.families.push(family); }
      action = { label: '表面连续放置', stroke: command.stroke, changes: positions.map(position => ({ position, before: world.overrideAt(position), after: { shape: 3, material: selected } })) };
      patches = world.commit(action); entry.painter.surface.record(positions);
    } catch (reason) { entry.painter.failed = true; throw reason; }
    finally { if (command.end) strokePainters.delete(world); }
  } else if (command.type === 'refresh') {
    if (doc.wallLayoutVersion === WALL_LAYOUT_VERSION) return;
    const families = [...doc.families];
    try { generated = generatedDiff(world); } catch (reason) { doc.families = families; throw reason; }
    world.setGenerated(generated); doc.wallLayoutVersion = WALL_LAYOUT_VERSION; doc.revision++;
  } else if (command.type === 'brush') {
    if (!validPoint(command.a) || command.b && !validPoint(command.b)) throw new Error('笔刷坐标无效。');
    const family = FAMILIES.find(value => value.id === command.selected); if (!family) throw new Error('所选方块无效。');
    selected = doc.families.findIndex(value => value.full === family.full); if (selected < 0) { selected = doc.families.length; doc.families.push(family); }
    const { settings, a, b } = command;
    if (!['block', 'box', 'sphere', 'smooth', 'fracture'].includes(settings.kind)) throw new Error('请先选择有效笔刷。');
    if (settings.kind === 'box' && (!settings.size.every(value => Number.isSafeInteger(value) && value > 0) || !settings.fixed && !b)
      || settings.kind === 'sphere' && (settings.fixed ? !Number.isFinite(settings.radius) || settings.radius < 1 : !b)) throw new Error('请设置有效尺寸并完成选点。');
    const changes = settings.kind === 'smooth' ? smoothChanges(world, a, settings.smoothRadius, settings.strength, selected)
      : settings.kind === 'fracture' ? fractureChanges(world, a, settings)
      : (settings.kind === 'block' ? [a] : shapeCells(settings, a, b)).filter(position => !world.shapeAt(...position))
        .map(position => ({ position, before: world.overrideAt(position), after: { shape: 3, material: selected } }));
    if (!changes.length) return;
    const error = world.rangeError(changes.map(change => change.position)); if (error) throw new Error(error);
    action = { label: settings.kind === 'smooth' ? '地表平滑' : settings.kind === 'fracture' ? '地表龟裂' : '笔刷放置', changes,
      stroke: ['block', 'smooth'].includes(settings.kind) ? command.stroke : undefined }; patches = world.commit(action);
  } else if (command.type === 'node' || command.type === 'preset') {
    if (command.type === 'node' && command.node && JSON.stringify(doc.nodes.find(node => node.id === command.node!.id)) === JSON.stringify(command.node)
      || command.type === 'preset' && JSON.stringify(doc.presets.find(preset => preset.id === command.preset.id)) === JSON.stringify(command.preset)) return;
    action = { label: command.type === 'node' ? '修改墙节点' : '修改墙预设', changes: [] };
    const beforeNodes = doc.nodes, beforePresets = doc.presets, beforeFamilies = [...doc.families];
    if (command.type === 'node') {
      if (command.node) validateNode(command.node, doc.presets);
      const nodes = command.node ? doc.nodes.some(node => node.id === command.node!.id)
        ? doc.nodes.map(node => node.id === command.node!.id ? command.node! : node) : [...doc.nodes, command.node]
        : doc.nodes.filter(node => node.id !== command.remove);
      action.nodes = { before: doc.nodes, after: nodes }; doc.nodes = nodes;
    } else {
      validatePreset(command.preset); const presets = doc.presets.some(preset => preset.id === command.preset.id)
        ? doc.presets.map(preset => preset.id === command.preset.id ? command.preset : preset) : [...doc.presets, command.preset];
      action.presets = { before: doc.presets, after: presets }; doc.presets = presets;
    }
    try { generated = generatedDiff(world); }
    catch (reason) { doc.nodes = beforeNodes; doc.presets = beforePresets; doc.families = beforeFamilies; throw reason; }
    doc.nodes = beforeNodes; doc.presets = beforePresets;
    patches = world.commit(action); world.setGenerated(generated); doc.wallLayoutVersion = WALL_LAYOUT_VERSION;
  } else if (command.type === 'limit') world.setLimit(command.value);
  else if (command.type === 'select') {
    if (!FAMILIES.some(value => value.id === command.id)) throw new Error('所选方块无效。'); doc.selected = command.id; doc.revision++;
  }
  else {
    const candidate = doc.history[command.type === 'undo' ? doc.cursor - 1 : doc.cursor]; if (!candidate) return;
    if (candidate.nodes || candidate.presets) {
      const nodes = doc.nodes, presets = doc.presets, families = [...doc.families];
      if (candidate.nodes) doc.nodes = candidate.nodes[command.type === 'undo' ? 'before' : 'after'];
      if (candidate.presets) doc.presets = candidate.presets[command.type === 'undo' ? 'before' : 'after'];
      try { generated = generatedDiff(world); } catch (reason) { doc.families = families; throw reason; }
      finally { doc.nodes = nodes; doc.presets = presets; }
    }
    patches = (command.type === 'undo' ? world.undo() : world.redo()) ?? []; world.setGenerated(generated);
    if (candidate.nodes || candidate.presets) doc.wallLayoutVersion = WALL_LAYOUT_VERSION;
  }
  return { patches, generated, nodes: doc.nodes, presets: doc.presets, action, cursor: doc.cursor, revision: doc.revision, limit: doc.limit, families: doc.families, selected: doc.selected, wallLayoutVersion: doc.wallLayoutVersion };
}
