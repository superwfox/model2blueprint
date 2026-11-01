import { computed, ref, shallowRef } from 'vue';
import type { Object3D } from 'three';
import { loadGlb, loadGlbScene, disposeModel } from '../adapters/glb.ts';
import { Downloads } from '../adapters/download.ts';
import type { Viewer } from '../adapters/renderer/viewer.ts';
import { WorkerClient } from '../adapters/worker/client.ts';
import type { WorkerRequest } from '../adapters/worker/protocol.ts';
import { gridSize } from '../core/geometry.ts';
import { FAMILIES, suggestFamily } from '../core/palette.ts';
import { familyColors } from '../core/colors.ts';
import { familyTextures } from '../core/texture-data.ts';
import type { BlockFamily, BlockKind, BlockOption, ManualVariants, ModelData, SurfaceData, VoxelResult } from '../core/types.ts';
import type { HistoryView } from '../adapters/history/types.ts';
import { useHistory } from './useHistory.ts';
import { useBuilding } from './useBuilding.ts';
import type { EditorIntent } from '../adapters/renderer/building-view.ts';
import { DEFAULT_SPEEDS, createNavigationProfiles } from '../adapters/renderer/navigation-types.ts';
import type { MovementMode, NavigationState, SpeedAxis } from '../adapters/renderer/navigation-types.ts';
import { validCamera } from '../adapters/history/validate.ts';

export type PreviewMode = 'original' | 'result';

/** One session per mounted workspace; large buffers never enter deep reactivity. */
export function useWorkspace(afterReveal: () => Promise<void>) {
  const model = shallowRef<ModelData>(), result = shallowRef<VoxelResult>();
  const families = shallowRef<BlockFamily[]>([]), manualVariants = shallowRef<ManualVariants[]>([]);
  const filename = ref('model.glb'), horizontalSize = ref('256'), previewMode = ref<PreviewMode>('result');
  const busy = ref(false), canCancel = ref(false), validSize = ref(true);
  const phase = ref<'empty' | 'loading' | 'ready'>('empty'), progress = ref(0);
  const message = ref(''), error = ref(false);
  const client = new WorkerClient(), downloads = new Downloads();
  const history = useHistory();
  const navigationState = shallowRef<NavigationState>({ ...DEFAULT_SPEEDS, profiles: createNavigationProfiles(), firstPerson: false, flying: false, selecting: false });
  const navigationPulse = ref(0);
  let viewer: Viewer | undefined, originalScene: Object3D | undefined;
  let sourceBlob: Blob | undefined, surface: SurfaceData | undefined, committedSize = '256';
  let stopViewListener: (() => void) | undefined;
  let stopNavigationListener: (() => void) | undefined;
  let stopEditorListener: (() => void) | undefined;
  let disposed = false;
  let switching = false;
  const building = useBuilding({ history, viewer: () => viewer, view: viewState, notice: status, fork: () => {
    model.value = undefined; result.value = undefined; sourceBlob = undefined; originalScene = undefined; surface = undefined;
    filename.value = building.title.value; previewMode.value = 'result'; viewer?.dropOriginal();
  } });
  const hasWorld = computed(() => Boolean(model.value || building.world.value));
  const hasPreview = computed(() => Boolean(result.value || building.world.value));
  const canDownload = computed(() => !busy.value && validSize.value && (building.world.value ? building.count.value > 0 : Boolean(result.value)));

  function status(text: string, failed = false): void { message.value = text; error.value = failed; }
  function setBusy(value: boolean): void {
    busy.value = value; canCancel.value = false;
    phase.value = value ? 'loading' : result.value || building.world.value ? 'ready' : 'empty';
    progress.value = 0;
  }
  function fail(reason: unknown): void {
    if (disposed) return;
    if (reason instanceof DOMException && reason.name === 'AbortError') { status('已取消'); return; }
    status(reason instanceof Error ? reason.message : '转换失败，请重新选择模型。', true);
  }
  async function prepareSwitch(): Promise<boolean> {
    if (disposed || busy.value || switching) return false;
    switching = true;
    if (await building.flush() && !disposed) return true;
    switching = false; return false;
  }
  function viewState(): HistoryView {
    const { horizontal, vertical, profiles } = navigationState.value;
    const camera = viewer?.getCameraState();
    return { mode: previewMode.value, camera: camera && validCamera(camera) ? camera : undefined,
      navigation: { horizontal, vertical }, navigationProfiles: profiles };
  }
  function rememberView(): void {
    if (disposed || busy.value || (!result.value && !building.world.value)) return;
    const state = viewState(); if (viewer && !state.camera) return;
    history.updateView(state);
  }
  function flushView(): void { rememberView(); history.flushView(); void building.flush(); }
  function setViewer(value: Viewer | undefined): void {
    const camera = viewer?.getCameraState(), mode = previewMode.value;
    stopViewListener?.(); stopNavigationListener?.(); stopEditorListener?.(); viewer = value;
    // A viewport hot replacement reuses live data before listening for new camera changes.
    if (value && building.world.value) {
      originalScene = undefined;
      building.attachViewer(true); value.setNavigationProfiles(navigationState.value.profiles);
      if (camera && validCamera(camera)) value.restoreCamera(camera);
    } else if (value && model.value && result.value && surface) {
      originalScene = undefined; value.setModel(model.value, result.value.size); value.setVoxels(result.value);
      value.setResult(surface); value.setNavigationProfiles(navigationState.value.profiles ?? createNavigationProfiles(navigationState.value)); previewMode.value = 'result';
      if (camera && validCamera(camera)) value.restoreCamera(camera);
      if (mode === 'original' && !busy.value) void setMode('original');
    }
    stopViewListener = value?.onViewChanged(rememberView);
    stopNavigationListener = value?.onNavigation(state => { navigationState.value = state; },
      () => { navigationPulse.value++; }, (text, failed) => status(text, failed));
    stopEditorListener = value?.onEditor(editorIntent);
  }
  function setNavigationSpeed(mode: MovementMode, axis: SpeedAxis, value: number): void { if (!busy.value) viewer?.setNavigationSpeed(mode, axis, value); }
  function toggleFirstPerson(): void {
    if (busy.value || !hasPreview.value) return;
    if (building.editing.value) exitEdit(); viewer?.toggleFirstPerson();
  }
  function exitEdit(): void {
    building.exit();
    if (!building.forked.value) { building.clear(); if (result.value) viewer?.setVoxels(result.value); }
    status('');
  }
  function editorIntent(intent: EditorIntent): void {
    if (disposed || busy.value || building.working.value && intent.type !== 'stroke') return;
    if (intent.type === 'enter') {
      if (building.world.value) building.resume();
      else if (result.value && surface) building.fromImport(result.value, families.value, surface, filename.value);
      applyMode('result'); status('单击或长按放置，按住空格拖动旋转视角，Esc 结束选点或返回预览。');
    } else if (intent.type === 'exit') exitEdit();
    else if (intent.type === 'undo') building.undo();
    else if (intent.type === 'redo') building.redo();
    else if (intent.type === 'place') building.place(intent.position);
    else if (intent.type === 'brush') building.applyBrush(intent.a, intent.b, intent.stroke);
    else if (intent.type === 'stroke') building.paintStroke(intent.stroke, intent.rays, intent.end);
    else if (intent.type === 'node') void building.saveNode(intent.node, true);
  }
  async function startBlank(): Promise<void> {
    if (!await prepareSwitch()) return;
    try {
      if (!viewer) { status('三维预览不可用，无法从空白模板放置方块；仍可导入 GLB、切片和下载。', true); return; }
      flushView(); building.clear(); building.blank(); validSize.value = true;
      viewer.setNavigationProfiles(createNavigationProfiles()); phase.value = 'ready'; status('单击地面放置第一块方块。');
    } finally { switching = false; }
  }
  function applyMode(mode: PreviewMode): void { previewMode.value = mode; viewer?.setMode(mode); }
  async function setMode(mode: PreviewMode): Promise<void> {
    if (disposed || busy.value || !model.value || (mode === 'result' && !result.value)) return;
    if (mode === 'original' && !originalScene && sourceBlob && viewer) {
      setBusy(true); status('正在读取已缓存的原模');
      let scene: Object3D | undefined;
      try {
        scene = await loadGlbScene(await sourceBlob.arrayBuffer());
        if (disposed) return;
        originalScene = scene; viewer.setOriginalPreview(scene); scene = undefined;
        applyMode(mode); status('原模已恢复');
      } catch (reason) { fail(reason); }
      finally { if (scene) disposeModel(scene); if (!disposed) setBusy(false); }
    } else applyMode(mode);
    rememberView();
  }
  async function saveHistory(geometry: boolean): Promise<void> {
    if (!model.value || !result.value || !surface || !sourceBlob) return;
    await history.save({ filename: filename.value, source: { blob: sourceBlob, model: model.value },
      palette: { horizontalSize: committedSize, families: families.value, manual: manualVariants.value },
      result: result.value, surface, view: viewState() }, geometry);
  }
  async function run(job: WorkerRequest) {
    canCancel.value = true;
    try {
      return await client.run(job, update => {
        status(update.message); progress.value = Math.max(progress.value, Math.min(1, update.progress));
      });
    } finally { canCancel.value = false; }
  }
  function checkSize(): void {
    try { if (model.value) gridSize(model.value, Number(horizontalSize.value)); validSize.value = true; }
    catch { validSize.value = false; }
  }
  async function executeConversion(): Promise<void> {
    if (!model.value) return;
    const size = gridSize(model.value, Number(horizontalSize.value)); validSize.value = true;
    viewer?.resizeModel(model.value, size);
    const reply = await run({ type: 'convert', model: model.value, horizontalSize: Number(horizontalSize.value),
      colors: families.value.map(familyColors), textures: families.value.map(familyTextures),
      animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches });
    if (disposed || reply.type !== 'done') return;
    result.value = reply.output.result; surface = reply.output.surface; committedSize = horizontalSize.value;
    viewer?.setVoxels(result.value); viewer?.setResult(surface, reply.output.falling); applyMode('result');
    await saveHistory(true); if (disposed) return;
    status(reply.output.surface.warning ?? (viewer ? '转换完成' : '三维预览不可用，可使用切片或下载到 Axiom 查看。'), Boolean(reply.output.surface.warning) || !viewer);
    // Vue commits the ready state before we wait for the original overlay transition.
    phase.value = 'ready'; await afterReveal();
    if (!disposed) viewer?.startResultAnimation();
  }
  async function convertCurrent(): Promise<void> {
    if (disposed || busy.value || switching || !model.value) return;
    setBusy(true); status('');
    building.clear();
    try { await executeConversion(); } catch (reason) { checkSize(); fail(reason); }
    finally { if (!disposed) setBusy(false); }
  }
  async function openFile(file: File): Promise<void> {
    if (!await prepareSwitch()) return;
    setBusy(true); status('');
    let loadedScene: typeof originalScene;
    try {
      const buffer = await file.arrayBuffer(); if (disposed) return;
      const loaded = await loadGlb(buffer); loadedScene = loaded.scene;
      if (disposed) return;
      const size = gridSize(loaded.model, Number(horizontalSize.value));
      building.clear();
      history.beginImport(); sourceBlob = file; surface = undefined;
      viewer?.setNavigationProfiles(createNavigationProfiles());
      if (!viewer && originalScene) disposeModel(originalScene);
      model.value = loaded.model; originalScene = loaded.scene; filename.value = file.name;
      families.value = loaded.model.materials.map(material => FAMILIES[suggestFamily(material)]);
      manualVariants.value = loaded.model.materials.map(() => ({ slab: false, stairs: false, shelf: false }));
      result.value = undefined; validSize.value = true;
      viewer?.setModel(loaded.model, size, loaded.scene); loadedScene = undefined;
      await executeConversion();
    } catch (reason) { checkSize(); fail(reason); }
    finally {
      if (loadedScene) disposeModel(loadedScene);
      switching = false;
      if (!disposed) setBusy(false);
    }
  }
  async function changeMaterial(index: number, kind: BlockKind, choice: BlockOption): Promise<void> {
    if (disposed || busy.value) return;
    const previous = families.value[index], previousManual = manualVariants.value[index];
    if (!previous || !previousManual) return;
    let next: BlockFamily;
    if (kind === 'full') {
      const selected = FAMILIES.find(family => family.id === choice.id); if (!selected) return;
      next = { ...selected };
      for (const variant of ['slab', 'stairs', 'shelf'] as const) if (previousManual[variant]) {
        next[variant] = previous[variant]; next[`${variant}Color`] = previous[`${variant}Color`];
      }
    } else next = { ...previous, [kind]: `minecraft:${choice.id}`, [`${kind}Color`]: choice.color };
    const nextFamilies = [...families.value]; nextFamilies[index] = next; families.value = nextFamilies;
    const nextManual = [...manualVariants.value];
    nextManual[index] = kind === 'full' ? previousManual : { ...previousManual, [kind]: true };
    manualVariants.value = nextManual;
    if (!result.value) return;
    setBusy(true); status('');
    try {
      const reply = await run({ type: 'remesh', result: result.value, colors: families.value.map(familyColors), textures: families.value.map(familyTextures) });
      if (!disposed && reply.type === 'surface') {
        surface = reply.surface; viewer?.setResult(surface); applyMode(previewMode.value);
        await saveHistory(false); if (disposed) return;
        status(reply.surface.warning ?? '材质已更新', Boolean(reply.surface.warning));
      }
    } catch (reason) {
      if (!disposed) {
        const restored = [...families.value]; restored[index] = previous; families.value = restored;
        const flags = [...manualVariants.value]; flags[index] = previousManual; manualVariants.value = flags;
        fail(reason);
      }
    } finally { if (!disposed) setBusy(false); }
  }
  async function downloadSchem(): Promise<void> {
    if (disposed || !canDownload.value) return;
    setBusy(true); status('');
    try {
      if (building.world.value) {
        const bytes = await building.download(); if (!disposed) { downloads.save(bytes, building.title.value); status('文件已生成'); } return;
      }
      if (!result.value) return;
      const reply = await run({ type: 'export', result: result.value, families: families.value });
      if (!disposed && reply.type === 'exported') { downloads.save(reply.bytes, filename.value); status('文件已生成'); }
    } catch (reason) { fail(reason); }
    finally { if (!disposed) setBusy(false); }
  }
  async function restoreRecord(id: string): Promise<void> {
    let loadedScene: typeof originalScene;
    try {
      if (history.entries.value.find(entry => entry.id === id)?.kind === 'building') {
        const saved = await history.readBuilding(id); if (disposed) return;
        building.clear(); model.value = undefined; result.value = undefined; originalScene = undefined; sourceBlob = undefined; surface = undefined;
        building.restore(saved); filename.value = saved.entry.filename; validSize.value = true; applyMode('result');
        viewer?.setNavigationProfiles(saved.entry.view.navigationProfiles ?? createNavigationProfiles());
        if (saved.entry.view.camera) viewer?.restoreCamera(saved.entry.view.camera);
        await history.activate(saved.entry); if (disposed) return;
        status(viewer ? '建筑已恢复，可继续编辑。' : '三维预览不可用，可使用切片或下载。', !viewer); phase.value = 'ready'; return;
      }
      const saved = await history.read(id); if (disposed) return;
      if (saved.entry.view.mode === 'original' && viewer) loadedScene = await loadGlbScene(await saved.source.blob.arrayBuffer());
      if (disposed) return;
      building.clear();
      if (!viewer && originalScene) disposeModel(originalScene);
      sourceBlob = saved.source.blob; model.value = saved.source.model; originalScene = loadedScene;
      filename.value = saved.entry.filename; horizontalSize.value = committedSize = saved.palette.horizontalSize;
      families.value = saved.palette.families; manualVariants.value = saved.palette.manual;
      result.value = saved.result; surface = saved.surface; validSize.value = true;
      viewer?.setModel(saved.source.model, saved.result.size, loadedScene); loadedScene = undefined;
      viewer?.setVoxels(saved.result);
      viewer?.setNavigationProfiles(saved.entry.view.navigationProfiles ?? createNavigationProfiles(saved.entry.view.navigation ?? DEFAULT_SPEEDS));
      viewer?.setResult(surface); applyMode(saved.entry.view.mode);
      if (saved.entry.view.camera) viewer?.restoreCamera(saved.entry.view.camera);
      await history.activate(saved.entry); if (disposed) return;
      status(surface.warning ?? (viewer ? '已恢复本地历史记录' : '三维预览不可用，可使用切片或下载。'), Boolean(surface.warning) || !viewer);
      phase.value = 'ready'; await afterReveal();
    } finally { if (loadedScene) disposeModel(loadedScene); }
  }
  async function restoreHistory(id: string): Promise<void> {
    if (!await prepareSwitch()) return;
    flushView(); setBusy(true); status('正在恢复本地记录');
    try { await restoreRecord(id); } catch (reason) { fail(reason); }
    finally { switching = false; if (!disposed) { setBusy(false); rememberView(); } }
  }
  async function initialize(): Promise<void> {
    setBusy(true);
    try {
      const id = await history.initialize();
      if (!disposed && id) { status('正在恢复上次工作状态'); await restoreRecord(id); }
    } catch (reason) { fail(reason); }
    finally { if (!disposed) { setBusy(false); rememberView(); } }
  }
  async function deleteHistory(id: string): Promise<void> {
    if (disposed || busy.value || switching) return;
    switching = true;
    try {
      // Deleting older records must remain possible when an autosave failed for lack of space.
      await building.flush(); if (disposed) return;
      rememberView(); history.flushView(); setBusy(true); await history.remove(id);
      if (!disposed && !history.isDetached()) await building.flush();
    } finally { switching = false; if (!disposed) setBusy(false); }
  }
  const downloadTitle = computed(() => {
    if (building.world.value) return `下载 .schem · ${building.count.value.toLocaleString()} 格`;
    if (!result.value) return '下载 .schem';
    const { size, stats: s } = result.value, count = s.full + s.bottom + s.top + s.stairs + s.shelves;
    return `下载 .schem · ${size.width}×${size.length}×${size.height} · ${count.toLocaleString()} 格\n完整方块 ${s.full.toLocaleString()} · 下半砖 ${s.bottom.toLocaleString()} · 上半砖 ${s.top.toLocaleString()} · 楼梯 ${s.stairs.toLocaleString()} · 展示架 ${s.shelves.toLocaleString()}`;
  });
  function dispose(): void {
    if (disposed) return;
    flushView(); disposed = true; stopViewListener?.(); stopNavigationListener?.(); stopEditorListener?.(); building.dispose(); history.dispose(); client.dispose(); downloads.dispose();
    if (!viewer && originalScene) disposeModel(originalScene);
    originalScene = undefined; viewer = undefined; sourceBlob = undefined; surface = undefined;
    model.value = undefined; result.value = undefined; families.value = []; manualVariants.value = [];
  }
  return { model, result, families, manualVariants, filename, horizontalSize, previewMode, busy, canCancel, validSize,
    phase, progress, message, error, downloadTitle, setViewer, setMode, openFile, convertCurrent, changeMaterial,
    historyEntries: history.entries, currentHistoryId: history.currentId, cacheWarning: history.warning,
    navigationState, navigationPulse, setNavigationSpeed, toggleFirstPerson,
    building, hasWorld, hasPreview, canDownload, startBlank, exitEdit, resumeEdit: () => editorIntent({ type: 'enter' }),
    initialize, restoreHistory, deleteHistory, flushView, downloadSchem, cancel: () => client.cancel(), fit: () => viewer?.fit(), dispose };
}
