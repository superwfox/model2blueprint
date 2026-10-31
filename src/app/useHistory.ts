import { ref, shallowRef } from 'vue';
import { HistoryDatabase } from '../adapters/history/database.ts';
import { validateSnapshot } from '../adapters/history/validate.ts';
import { forgetView, lastView, rememberView } from '../adapters/history/view-cache.ts';
import { DATA_VERSION } from '../core/schem.ts';
import type { HistoryEntry, HistorySnapshot, HistoryView } from '../adapters/history/types.ts';

type SaveData = Omit<HistorySnapshot, 'entry'> & { filename: string; view: HistoryView };

/** Import identity and persistence are independent from the live view and Worker tasks. */
export function useHistory() {
  const entries = shallowRef<HistoryEntry[]>([]), currentId = ref<string>();
  const warning = ref('');
  const database = new HistoryDatabase();
  let detached = false, synchronized = true, disposed = false, pending: { id: string; view: HistoryView; time: number } | undefined;
  let viewTimer: ReturnType<typeof setTimeout> | undefined;
  let viewWrite: Promise<void> = Promise.resolve();
  let geometryDirty = false;

  function failed(reason: unknown): void {
    if (disposed) return;
    warning.value = reason instanceof DOMException && reason.name === 'QuotaExceededError'
      ? '本地空间不足，本次状态未缓存；旧记录已保留。请删除不需要的历史后重试。'
      : `本次状态未缓存，旧记录已保留。${reason instanceof Error ? reason.message : '本地存储不可用。'}`;
  }
  function replace(entry: HistoryEntry): void {
    entries.value = [entry, ...entries.value.filter(value => value.id !== entry.id)].sort((a, b) => b.createdAt - a.createdAt);
  }
  async function initialize(): Promise<string | undefined> {
    try {
      const saved = await database.bootstrap(); if (disposed) return;
      entries.value = saved.entries.sort((a, b) => b.createdAt - a.createdAt);
      return entries.value.find(entry => entry.id === saved.activeId)?.id ?? entries.value[0]?.id;
    } catch (reason) { failed(reason); }
  }
  function flushView(): void {
    clearTimeout(viewTimer); viewTimer = undefined;
    const value = pending; pending = undefined;
    if (value) {
      rememberView(value);
      viewWrite = database.updateView(value.id, value.view, value.time).catch(failed);
    }
  }
  function updateView(view: HistoryView): void {
    if (disposed || !currentId.value || detached || !synchronized) return;
    const value = { id: currentId.value, view, time: Date.now() };
    pending = value;
    if (!viewTimer) viewTimer = setTimeout(flushView, 250);
  }
  function beginImport(): void { flushView(); currentId.value = undefined; detached = false; synchronized = true; geometryDirty = false; }
  async function save(data: SaveData, geometry: boolean): Promise<void> {
    if (disposed || detached) return;
    flushView();
    const previous = entries.value.find(entry => entry.id === currentId.value), now = Date.now();
    const writeGeometry = geometry || geometryDirty || !previous;
    try {
      const { width, height, length } = data.result.size, s = data.result.stats;
      const entry: HistoryEntry = { id: previous?.id ?? crypto.randomUUID(), filename: data.filename,
        createdAt: previous?.createdAt ?? now, updatedAt: now, dimensions: { width, height, length },
        blocks: s.full + s.bottom + s.top + s.stairs + s.shelves, view: data.view, viewUpdatedAt: now, format: 1, dataVersion: DATA_VERSION };
      await database.write({ entry, palette: data.palette, result: data.result, surface: data.surface,
        geometry: writeGeometry, source: previous ? undefined : data.source });
      if (disposed) return;
      currentId.value = entry.id; synchronized = true; geometryDirty = false;
      replace(entry); rememberView({ id: entry.id, view: entry.view, time: now }); warning.value = '';
    } catch (reason) { synchronized = false; geometryDirty = writeGeometry; failed(reason); }
  }
  async function read(id: string): Promise<HistorySnapshot> {
    flushView();
    const snapshot = await database.read(id); validateSnapshot(snapshot);
    const recent = lastView(id);
    if (recent && recent.time >= snapshot.entry.viewUpdatedAt) snapshot.entry = { ...snapshot.entry, view: recent.view, viewUpdatedAt: recent.time };
    return snapshot;
  }
  async function activate(entry: HistoryEntry): Promise<void> {
    currentId.value = entry.id; detached = false; synchronized = true; geometryDirty = false; replace(entry);
    try { await database.activate(entry.id); warning.value = ''; } catch (reason) { failed(reason); }
  }
  async function remove(id: string): Promise<void> {
    flushView();
    try {
      await database.remove(id); if (disposed) return;
      entries.value = entries.value.filter(entry => entry.id !== id); forgetView(id);
      if (currentId.value === id) { currentId.value = undefined; detached = true; }
    } catch (reason) { failed(reason); }
  }
  function dispose(): void { flushView(); disposed = true; void viewWrite.finally(() => database.close()); }
  return { entries, currentId, warning, initialize, beginImport, save, read, activate, remove, updateView, flushView, dispose };
}
