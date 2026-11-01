import { computed, ref, shallowRef } from 'vue';
import { BuildingWorld, createBuilding, dirtyChunks, neighborChunks } from '../core/building.ts';
import { defaultBrush, defaultPreset, WALL_LAYOUT_VERSION } from '../core/brush-types.ts';
import type { BrushSettings, WallNode, WallPreset } from '../core/brush-types.ts';
import type { BuildingCommand } from '../core/building-commands.ts';
import type { StrokeRay } from '../core/surface-stroke.ts';
import { dimensions } from '../core/block-world.ts';
import { FAMILIES } from '../core/palette.ts';
import { DATA_VERSION } from '../core/schem.ts';
import { EditorClient } from '../adapters/editor/client.ts';
import type { BuildingDocument } from '../core/building.ts';
import type { BlockFamily, SurfaceData, Vec3, VoxelResult } from '../core/types.ts';
import type { BuildingSnapshot, BuildingWrite, HistoryEntry, HistoryView } from '../adapters/history/types.ts';
import type { Viewer } from '../adapters/renderer/viewer.ts';
import type { useHistory } from './useHistory.ts';

interface Options {
  history: ReturnType<typeof useHistory>; viewer: () => Viewer | undefined; view: () => HistoryView;
  notice: (message: string, failed?: boolean) => void; fork: () => void;
}
export function useBuilding(options: Options) {
  const world = shallowRef<BuildingWorld>(), editing = ref(false), revision = ref(0), forked = ref(false), saving = ref(false);
  const selected = ref('stone'), title = ref('未命名建筑'), savedRevision = ref(-1), saveError = ref(false);
  const brush = shallowRef(defaultBrush()), selectedNode = ref(''), working = ref(false);
  let client: EditorClient | undefined, baseSurface: SurfaceData | undefined, previous: HistoryEntry | undefined;
  let persisted = false, generation = 0, disposed = false, needsSave = false, savePromise: Promise<void> | undefined;
  let operations: Promise<unknown> = Promise.resolve(), queued = 0;
  const dirty = new Set<string>(), dirtyGenerated = new Set<string>();
  const nodes = computed(() => { void revision.value; return world.value?.document.nodes ?? []; });
  const presets = computed(() => { void revision.value; return world.value?.document.presets ?? []; });
  const families = computed(() => { void revision.value; return world.value?.document.families ?? []; });
  const count = computed(() => { void revision.value; return world.value?.count ?? 0; });
  const canUndo = computed(() => { void revision.value; return Boolean(world.value?.document.cursor); });
  const canRedo = computed(() => { void revision.value; const doc = world.value?.document; return Boolean(doc && doc.cursor < doc.history.length); });
  const limit = computed(() => { void revision.value; return world.value?.document.limit ?? 50; });
  const saveStatus = computed(() => {
    void options.history.currentId.value;
    return !forked.value ? '首次放置另存' : options.history.isDetached() ? '已脱离历史'
      : saveError.value ? '未保存' : saving.value || savedRevision.value !== revision.value ? '保存中' : '已保存';
  });

  function startWorker(): void {
    client?.dispose(); working.value = false; queued = 0; operations = Promise.resolve(); options.viewer()?.setEditorBlocked(false);
    const current = world.value, token = ++generation; if (!current) return;
    try {
      client = new EditorClient(current.document, chunks => {
        if (!disposed && token === generation) options.viewer()?.applyBuildingMeshes(chunks);
      }, message => { if (!disposed && token === generation) options.notice(message, true); }, (baseSurface?.positions.length ?? 0) / 9);
      if (current.document.wallLayoutVersion !== WALL_LAYOUT_VERSION) void run({ type: 'refresh' });
    } catch (reason) { options.notice(reason instanceof Error ? reason.message : '建筑后台初始化失败。', true); }
  }
  function attachViewer(fit = false): void {
    if (!world.value) return;
    if (fit) options.viewer()?.showBuilding(world.value, baseSurface);
    else options.viewer()?.setBlockWorld(world.value, editing.value);
    options.viewer()?.setEditing(editing.value); startWorker();
    options.viewer()?.setWallNodes(world.value.document.nodes);
    options.viewer()?.setBrushSettings(brush.value);
  }
  function install(doc: BuildingDocument, surface?: SurfaceData, entry?: HistoryEntry): void {
    client?.dispose(); generation++; world.value = new BuildingWorld(doc); baseSurface = surface;
    previous = entry; persisted = Boolean(entry); forked.value = Boolean(entry); editing.value = true;
    selected.value = doc.selected; revision.value = doc.revision; savedRevision.value = entry ? doc.revision : -1;
    saveError.value = false; dirty.clear(); dirtyGenerated.clear(); needsSave = false;
    brush.value = { ...defaultBrush(), preset: doc.presets[0]?.id ?? '' }; selectedNode.value = ''; working.value = false;
  }
  function fromImport(base: VoxelResult, palette: BlockFamily[], surface: SurfaceData, name: string): void {
    install(createBuilding(crypto.randomUUID(), palette, 'stone', base), surface);
    title.value = `${name.replace(/\.glb$/i, '')} · 建筑`; attachViewer();
  }
  function blank(): void {
    const stone = FAMILIES.find(family => family.id === 'stone')!;
    install(createBuilding(crypto.randomUUID(), [stone], 'stone')); title.value = '未命名建筑';
    options.history.beginImport(); forked.value = true; options.fork(); attachViewer(true); requestSave();
  }
  function restore(snapshot: BuildingSnapshot): void {
    install(snapshot.document, snapshot.baseSurface, snapshot.entry); title.value = snapshot.entry.filename; attachViewer(true);
  }
  function ensureFork(): void {
    if (forked.value) return;
    options.history.beginImport(); forked.value = true; options.fork();
  }
  function changed(): void {
    const current = world.value; if (!current) return;
    revision.value = current.document.revision;
    if (forked.value) requestSave();
  }
  function run(command: BuildingCommand): Promise<boolean> {
    const token = generation; if (disposed || !world.value || !client) return Promise.resolve(false);
    const payload = structuredClone(command); queued++; working.value = true; options.viewer()?.setEditorBlocked(true);
    const next = operations.then(() => token === generation && !disposed ? perform(payload, token) : false).finally(() => {
      if (token === generation && --queued === 0) { working.value = false; options.viewer()?.setEditorBlocked(false); }
    });
    operations = next.catch(() => false); return next;
  }
  async function perform(command: BuildingCommand, token: number): Promise<boolean> {
    const current = world.value; if (!current || !client) return false;
    try {
      const reply = await client.command(structuredClone(command)); if (disposed || generation !== token) return false;
      const delta = reply.delta; if (!delta) return false;
      current.accept(delta); selected.value = current.document.selected;
      options.viewer()?.setWallNodes(current.document.nodes);
      if (delta.action?.stroke) options.viewer()?.acceptStroke(delta.action.stroke, delta.patches.map(patch => patch.position));
      if (!current.document.nodes.some(node => node.id === selectedNode.value)) selectedNode.value = '';
      if (brush.value.kind === 'wall' && !current.document.presets.some(preset => preset.id === brush.value.preset)) {
        brush.value = { ...brush.value, preset: current.document.presets[0]?.id ?? '' }; options.viewer()?.setBrushSettings(brush.value);
      }
      if (selectedNode.value) options.viewer()?.highlightWall(current.document.nodes.find(node => node.id === selectedNode.value));
      for (const patch of delta.patches) dirty.add(dirtyChunks(patch.position)[0]);
      for (const write of delta.generated) dirtyGenerated.add(write.key);
      const keys = [...new Set([...delta.patches.flatMap(patch => dirtyChunks(patch.position)), ...delta.generated.flatMap(write => neighborChunks(write.key))])];
      options.viewer()?.markBuildingDirty(keys, delta.revision); options.viewer()?.applyBuildingMeshes(reply.chunks); options.viewer()?.updateBuildingGrid();
      if (delta.action) ensureFork(); changed(); return true;
    } catch (reason) {
      if (!disposed && generation === token) {
        if (command.type === 'stroke' || command.type === 'brush' && command.stroke) options.viewer()?.finishDrawing();
        options.notice(reason instanceof Error ? reason.message : '建筑操作失败。', true);
      }
      return false;
    }
  }
  function place(position: Vec3): void { if (editing.value) void run({ type: 'brush', settings: defaultBrush(), a: position, selected: selected.value }); }
  function applyBrush(a: Vec3, b?: Vec3, stroke?: string): void { if (editing.value) void run({ type: 'brush', settings: brush.value, a, b, selected: selected.value, stroke }); }
  function paintStroke(stroke: string, rays: StrokeRay[], end?: boolean): void { void run({ type: 'stroke', stroke, rays, selected: selected.value, end }); }
  function undo(): void { options.viewer()?.finishDrawing(); void run({ type: 'undo' }); }
  function redo(): void { options.viewer()?.finishDrawing(); void run({ type: 'redo' }); }
  function choose(id: string): void {
    if (!world.value || !FAMILIES.some(value => value.id === id) || id === selected.value) return;
    void run({ type: 'select', id });
  }
  function setLimit(value: number): void {
    if (world.value?.document.limit === value) return;
    void run({ type: 'limit', value });
  }
  async function configure(value: BrushSettings): Promise<void> {
    if (!Object.values(value).every(item => typeof item !== 'number' || Number.isFinite(item))
      || !value.size.every(item => Number.isSafeInteger(item) && item > 0) || value.radius < 1) { options.notice('请输入有效的笔刷尺寸与坐标。', true); return; }
    if (value.kind === 'wall' && !presets.value.length) {
      const preset = defaultPreset(crypto.randomUUID()); if (!await run({ type: 'preset', preset })) return; value = { ...value, preset: preset.id };
    }
    brush.value = structuredClone(value); options.viewer()?.setBrushSettings(brush.value);
  }
  async function savePreset(preset: WallPreset): Promise<void> {
    const created = !presets.value.some(value => value.id === preset.id);
    if (await run({ type: 'preset', preset }) && created) await configure({ ...brush.value, preset: preset.id });
  }
  async function saveNode(node: WallNode, continueDrawing = false): Promise<void> {
    if (!continueDrawing) options.viewer()?.finishDrawing();
    const selection = selectedNode.value;
    if (await run({ type: 'node', node }) && selectedNode.value === selection) selectNode(node.id);
  }
  function selectNode(id: string): void { selectedNode.value = id; options.viewer()?.highlightWall(nodes.value.find(node => node.id === id)); }
  function repickNode(id: string): void {
    const node = nodes.value.find(value => value.id === id); if (node) { void configure({ ...brush.value, kind: 'wall', preset: node.preset }); selectNode(id); options.viewer()?.repickWall(node); }
  }
  function focusNode(id: string): void { const node = nodes.value.find(value => value.id === id); if (node) { selectNode(id); options.viewer()?.focusWall(node); } }
  async function removeNode(id: string): Promise<void> { if (await run({ type: 'node', remove: id })) { selectedNode.value = ''; options.viewer()?.highlightWall(); } }
  function snapshot(): BuildingWrite {
    const current = world.value!, doc = current.document, { base, chunks, generated, ...metadata } = doc;
    const now = Date.now(), [width, height, length] = dimensions(current.bounds);
    const keys = persisted ? [...dirty] : [...chunks.keys()]; dirty.clear();
    const generatedKeys = persisted ? [...dirtyGenerated] : [...generated.keys()]; dirtyGenerated.clear();
    return { entry: { id: doc.id, kind: 'building', filename: title.value, createdAt: previous?.createdAt ?? now, updatedAt: now,
      dimensions: { width, height, length }, blocks: current.count, view: options.view(), viewUpdatedAt: now, format: 1, dataVersion: DATA_VERSION },
      metadata: { ...metadata, families: [...metadata.families], history: [...metadata.history] },
      chunks: keys.map(key => ({ key, chunk: chunks.has(key) ? structuredClone(chunks.get(key)!) : undefined })),
      generated: generatedKeys.map(key => ({ key, chunk: generated.has(key) ? structuredClone(generated.get(key)!) : undefined })),
      base, baseSurface, create: !persisted };
  }
  function requestSave(): void {
    if (disposed || !forked.value || options.history.isDetached()) return;
    needsSave = true; if (savePromise) return;
    saving.value = true;
    savePromise = (async () => {
      while (needsSave && !disposed) {
        needsSave = false; const write = snapshot();
        try {
          await options.history.saveBuilding(write); if (disposed) return; persisted = true; previous = write.entry;
          savedRevision.value = write.metadata.revision; saveError.value = false;
        } catch (reason) { for (const value of write.chunks) dirty.add(value.key); for (const value of write.generated) dirtyGenerated.add(value.key); needsSave = true; saveError.value = true; throw reason; }
      }
    })().finally(() => { saving.value = false; savePromise = undefined; });
    void savePromise.catch(() => {});
  }
  async function flush(): Promise<boolean> {
    if (working.value) { options.notice('建筑操作处理中，请完成后再切换。', true); return false; }
    if (options.history.isDetached()) return true;
    if (needsSave && !savePromise) requestSave();
    try { await savePromise; return !saveError.value; } catch { return false; }
  }
  async function download(): Promise<Uint8Array> { await operations; if (!client) throw new Error('建筑后台不可用。'); return client.export(); }
  function exit(): void { editing.value = false; options.viewer()?.setEditing(false); }
  function resume(): void { editing.value = true; options.viewer()?.setEditing(true); }
  function clear(): void {
    client?.dispose(); client = undefined; generation++; world.value = undefined; editing.value = false; forked.value = false;
    baseSurface = undefined; previous = undefined; persisted = false; dirty.clear(); dirtyGenerated.clear(); needsSave = false; working.value = false; queued = 0; operations = Promise.resolve();
  }
  function dispose(): void { disposed = true; client?.dispose(); generation++; }
  return { world, editing, revision, selected, title, forked, saving, families, count, canUndo, canRedo, limit, saveStatus,
    brush, working, nodes, presets, selectedNode, configure, applyBrush, paintStroke, savePreset, saveNode, selectNode, repickNode, removeNode, focusNode,
    fromImport, blank, restore, attachViewer, place, undo, redo, choose, setLimit, flush, download, exit, resume, clear, dispose };
}
