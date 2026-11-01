import { MAX_CELLS } from './geometry.ts';
import { VoxelWorld, dimensions } from './block-world.ts';
import type { BlockBounds, BlockWorld } from './block-world.ts';
import type { BlockFamily, Vec3, VoxelResult } from './types.ts';
import type { WallNode, WallPreset } from './brush-types.ts';
import { MAX_BRUSH_CELLS, upgradeWallPreset, WALL_LAYOUT_VERSION } from './brush-types.ts';

export const CHUNK_SIZE = 16, CHUNK_CELLS = 4096, ERASED = 255;
export interface BuildingChunk { origin: Vec3; shapes: Uint8Array; materials: Uint16Array; count: number; bounds: BlockBounds }
export interface CellValue { shape: number; material: number }
export interface CellPatch { position: Vec3; material: number | null; shape?: number }
export interface CellChange { position: Vec3; before?: CellValue; after?: CellValue }
export interface BuildingAction {
  label: string; changes: CellChange[]; stroke?: string;
  nodes?: { before: WallNode[]; after: WallNode[] }; presets?: { before: WallPreset[]; after: WallPreset[] };
}
export interface BuildingDocument {
  version: 2; id: string; base?: VoxelResult; families: BlockFamily[]; chunks: Map<string, BuildingChunk>;
  generated: Map<string, BuildingChunk>; nodes: WallNode[]; presets: WallPreset[];
  wallLayoutVersion?: 2 | 3;
  bounds: BlockBounds; history: BuildingAction[]; cursor: number; limit: number; revision: number; selected: string;
}
export interface ChunkWrite { key: string; chunk?: BuildingChunk }
export interface BuildingDelta {
  patches: CellPatch[]; generated: ChunkWrite[]; nodes: WallNode[]; presets: WallPreset[];
  action?: BuildingAction; cursor: number; revision: number; limit: number; families: BlockFamily[]; selected: string;
  wallLayoutVersion?: 2 | 3;
}
export function chunkKey(x: number, y: number, z: number): string { return `${Math.floor(x / 16)},${Math.floor(y / 16)},${Math.floor(z / 16)}`; }
export function localIndex([x, y, z]: Vec3): number { return (x & 15) + (z & 15) * 16 + (y & 15) * 256; }
export function cellPosition(chunk: BuildingChunk, index: number): Vec3 {
  return [chunk.origin[0] + index % 16, chunk.origin[1] + Math.floor(index / 256), chunk.origin[2] + Math.floor(index / 16) % 16];
}
const emptyBounds = (): BlockBounds => ({ min: [0, 0, 0], max: [0, 0, 0] });
export function newChunk(position: Vec3): BuildingChunk {
  return { origin: position.map(value => Math.floor(value / 16) * 16) as Vec3,
    shapes: new Uint8Array(CHUNK_CELLS), materials: new Uint16Array(CHUNK_CELLS), count: 0, bounds: emptyBounds() };
}
export function measureChunk(chunk: BuildingChunk): void {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity]; let count = 0;
  for (let i = 0; i < CHUNK_CELLS; i++) if (chunk.shapes[i]) {
    count++; const position = cellPosition(chunk, i);
    for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], position[axis]); max[axis] = Math.max(max[axis], position[axis] + 1); }
  }
  chunk.count = count; chunk.bounds = count ? { min, max } : emptyBounds();
}
export function createBuilding(id: string, families: BlockFamily[], selected: string, base?: VoxelResult): BuildingDocument {
  return { version: 2, id, base, families: [...families], selected, chunks: new Map(), generated: new Map(), nodes: [], presets: [], wallLayoutVersion: WALL_LAYOUT_VERSION,
    bounds: base ? new VoxelWorld(base).bounds : emptyBounds(), history: [], cursor: 0, limit: 50, revision: 0 };
}
/** v1 was additive only; preserve its saved cursor and all visible cells. */
export function upgradeBuilding(value: BuildingDocument): void {
  const legacy = value as unknown as { version: number; history: { position: Vec3; material: number }[] };
  if (legacy.version === 1) {
    value.history = legacy.history.map(action => ({ label: '放置方块', changes: [{ position: action.position, after: { shape: 3, material: action.material } }] }));
    value.generated = new Map(); value.nodes = []; value.presets = []; value.version = 2;
  }
  for (const preset of value.presets ?? []) upgradeWallPreset(preset);
  for (const action of value.history ?? []) if (action.presets) for (const preset of [...action.presets.before, ...action.presets.after]) upgradeWallPreset(preset);
}
export function dirtyChunks(position: Vec3): string[] {
  const keys = new Set([chunkKey(...position)]);
  for (let axis = 0; axis < 3; axis++) for (const step of [-1, 1]) { const next: Vec3 = [...position]; next[axis] += step; keys.add(chunkKey(...next)); }
  return [...keys];
}
export function neighborChunks(key: string): string[] {
  const origin = key.split(',').map(value => Number(value) * 16) as Vec3, keys = [key];
  for (let axis = 0; axis < 3; axis++) for (const step of [-16, 16]) { const next: Vec3 = [...origin]; next[axis] += step; if (next[1] >= 0) keys.push(chunkKey(...next)); }
  return keys;
}
export class BuildingWorld implements BlockWorld {
  readonly document: BuildingDocument;
  private base?: VoxelWorld;
  private differences = new Map<string, number>();
  private columnMax = new Map<string, number>();
  private total = 0;
  constructor(document: BuildingDocument) {
    this.document = document;
    upgradeBuilding(document); if (document.base) this.base = new VoxelWorld(document.base);
    this.refresh(new Set([...document.chunks.keys(), ...document.generated.keys()]));
  }
  get bounds(): BlockBounds { return this.document.bounds; }
  get count(): number { return this.total; }
  overrideAt(position: Vec3): CellValue | undefined {
    const chunk = this.document.chunks.get(chunkKey(...position)), index = localIndex(position), shape = chunk?.shapes[index];
    return shape ? { shape, material: chunk!.materials[index] } : undefined;
  }
  shapeAt(x: number, y: number, z: number): number {
    const key = chunkKey(x, y, z), index = localIndex([x, y, z]), shape = this.document.chunks.get(key)?.shapes[index];
    if (shape) return shape === ERASED ? 0 : shape;
    return this.base?.shapeAt(x, y, z) || this.document.generated.get(key)?.shapes[index] || 0;
  }
  materialAt(x: number, y: number, z: number): number {
    const key = chunkKey(x, y, z), index = localIndex([x, y, z]), chunk = this.document.chunks.get(key);
    if (chunk?.shapes[index]) return chunk.materials[index];
    if (this.base?.shapeAt(x, y, z)) return this.base.materialAt(x, y, z);
    return this.document.generated.get(key)?.materials[index] ?? 0;
  }
  /** Highest occupied surface in a column; empty space above the base is skipped in 16-cell steps. */
  topAt(x: number, z: number): number {
    const base = this.document.base, inside = Boolean(base && x >= 0 && z >= 0 && x < base.size.width && z < base.size.length);
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16), upper = Math.max(inside ? base!.size.height - 1 : -1, this.columnMax.get(`${cx},${cz}`) ?? -1);
    for (let cy = Math.floor(upper / 16); cy >= 0; cy--) {
      const key = `${cx},${cy},${cz}`, manual = this.document.chunks.get(key), generated = this.document.generated.get(key);
      if (!manual && !generated && (!inside || cy * 16 >= base!.size.height)) continue;
      for (let y = Math.min(upper, cy * 16 + 15); y >= cy * 16; y--) {
        const index = localIndex([x, y, z]), shape = manual?.shapes[index];
        if (shape) { if (shape !== ERASED) return y; continue; }
        if (inside && y < base!.size.height && base!.shapes[x + z * base!.size.width + y * base!.size.width * base!.size.length] || generated?.shapes[index]) return y;
      }
    }
    return -1;
  }
  placementError(position: Vec3): string {
    if (this.shapeAt(...position)) return '此格已有方块。';
    return this.rangeError([position]);
  }
  rangeError(positions: Vec3[]): string {
    const keys = new Set([...this.document.chunks.keys(), ...this.document.generated.keys()]);
    const min: Vec3 = this.count || this.base ? [...this.bounds.min] : [Infinity, Infinity, Infinity];
    const max: Vec3 = this.count || this.base ? [...this.bounds.max] : [-Infinity, -Infinity, -Infinity];
    for (const position of positions) {
      if (!position.every(value => Number.isSafeInteger(value) && Math.abs(value) < Number.MAX_SAFE_INTEGER - 65536) || position[1] < 0) return '不能放在地面以下或无效坐标。';
      keys.add(chunkKey(...position));
      for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], position[axis]); max[axis] = Math.max(max[axis], position[axis] + 1); }
    }
    const size = dimensions({ min, max });
    if (size.some(value => value > 65535) || size[0] * size[1] * size[2] > MAX_CELLS) return '建筑范围超过单边 65535 或 3200 万格上限。';
    return keys.size * CHUNK_CELLS > MAX_CELLS ? '编辑分块已达到内存预算。' : '';
  }
  patch(patch: CellPatch): void { this.patchMany([patch]); }
  patchMany(patches: CellPatch[]): void {
    const dirty = new Set<string>();
    for (const { position, material, shape } of patches) {
      const key = chunkKey(...position), index = localIndex(position); let chunk = this.document.chunks.get(key);
      if (!chunk && material === null) continue;
      if (!chunk) { chunk = newChunk(position); this.document.chunks.set(key, chunk); }
      chunk.shapes[index] = material === null ? 0 : shape === 0 ? ERASED : shape ?? 3; chunk.materials[index] = material ?? 0; dirty.add(key);
    }
    for (const key of dirty) { const chunk = this.document.chunks.get(key)!; measureChunk(chunk); if (!chunk.count) this.document.chunks.delete(key); }
    this.refresh(dirty);
  }
  setGenerated(writes: ChunkWrite[]): void {
    for (const { key, chunk } of writes) if (chunk) this.document.generated.set(key, chunk); else this.document.generated.delete(key);
    this.refresh(new Set(writes.map(write => write.key)));
  }
  private refresh(keys: Set<string>): void {
    for (const key of keys) {
      let difference = 0; const chunk = this.document.chunks.get(key) ?? this.document.generated.get(key);
      if (chunk) for (let index = 0; index < CHUNK_CELLS; index++) {
        const position = cellPosition(chunk, index); difference += Number(Boolean(this.shapeAt(...position))) - Number(Boolean(this.base?.shapeAt(...position)));
      }
      this.differences.set(key, difference);
    }
    const stats = this.document.base?.stats;
    this.total = stats ? stats.full + stats.bottom + stats.top + stats.stairs + stats.shelves : 0;
    for (const difference of this.differences.values()) this.total += difference;
    const min: Vec3 = this.base ? [...this.base.bounds.min] : [Infinity, Infinity, Infinity], max: Vec3 = this.base ? [...this.base.bounds.max] : [-Infinity, -Infinity, -Infinity];
    let occupied = Boolean(this.base);
    this.columnMax.clear();
    for (const chunks of [this.document.chunks, this.document.generated]) for (const chunk of chunks.values()) {
      const key = `${chunk.origin[0] / 16},${chunk.origin[2] / 16}`; this.columnMax.set(key, Math.max(this.columnMax.get(key) ?? -1, chunk.origin[1] + 15));
      occupied = true; for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], chunk.bounds.min[axis]); max[axis] = Math.max(max[axis], chunk.bounds.max[axis]); }
    }
    this.document.bounds = occupied ? { min, max } : emptyBounds();
  }
  commit(action: BuildingAction): CellPatch[] {
    const combined = this.combinedAction(action);
    if (combined.changes.length > MAX_BRUSH_CELLS) throw new Error('一次连续操作最多修改 262,144 格，请松开后继续。');
    const patches = this.applyAction(action, false); this.recordAction(action, combined); this.document.revision++; return patches;
  }
  private combinedAction(action: BuildingAction): BuildingAction {
    const doc = this.document, previous = doc.history[doc.cursor - 1];
    if (!action.stroke || previous?.stroke !== action.stroke || doc.cursor !== doc.history.length) return action;
    const cells = new Map(previous.changes.map(change => [change.position.join(','), change]));
    for (const change of action.changes) { const key = change.position.join(','), first = cells.get(key); cells.set(key, first ? { ...change, before: first.before } : change); }
    return { ...action, changes: [...cells.values()] };
  }
  private recordAction(action: BuildingAction, combined = this.combinedAction(action)): void {
    const doc = this.document, merge = combined !== action; doc.history.splice(doc.cursor);
    if (merge) doc.history[doc.cursor - 1] = combined;
    else { doc.history.push(action); doc.cursor++; }
    this.trimHistory();
  }
  private applyAction(action: BuildingAction, reverse: boolean): CellPatch[] {
    if (action.nodes) this.document.nodes = action.nodes[reverse ? 'before' : 'after'];
    if (action.presets) this.document.presets = action.presets[reverse ? 'before' : 'after'];
    const patches = action.changes.map(change => { const value = change[reverse ? 'before' : 'after'];
      return { position: change.position, material: value?.material ?? null, shape: value?.shape === ERASED ? 0 : value?.shape }; });
    this.patchMany(patches); return patches;
  }
  place(position: Vec3, material: number): CellPatch[] {
    const error = this.placementError(position); if (error) throw new Error(error);
    if (!this.document.families[material]) throw new Error('所选方块无效。');
    return this.commit({ label: '放置方块', changes: [{ position: [...position], before: this.overrideAt(position), after: { shape: 3, material } }] });
  }
  undo(): CellPatch[] | undefined {
    if (!this.document.cursor) return;
    const patches = this.applyAction(this.document.history[--this.document.cursor], true); this.document.revision++; return patches;
  }
  redo(): CellPatch[] | undefined {
    const action = this.document.history[this.document.cursor]; if (!action) return;
    const patches = this.applyAction(action, false); this.document.cursor++; this.document.revision++; return patches;
  }
  setLimit(limit: number): void {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('记录步数请输入正整数。');
    this.document.limit = limit; this.trimHistory(); this.document.revision++;
  }
  private trimHistory(): void {
    const keep = Math.min(this.document.cursor, this.document.limit), start = this.document.cursor - keep;
    this.document.history = this.document.history.slice(start, start + this.document.limit); this.document.cursor = keep;
  }
  accept(delta: BuildingDelta): void {
    const doc = this.document; doc.families = delta.families; doc.nodes = delta.nodes; doc.presets = delta.presets; doc.selected = delta.selected;
    this.patchMany(delta.patches); this.setGenerated(delta.generated); doc.wallLayoutVersion = delta.wallLayoutVersion;
    if (delta.action) this.recordAction(delta.action);
    else if (doc.limit === delta.limit) doc.cursor = delta.cursor;
    doc.limit = delta.limit; this.trimHistory(); doc.cursor = delta.cursor; doc.revision = delta.revision;
  }
}
