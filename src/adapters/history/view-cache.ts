import { validCamera, validSpeeds, validProfiles } from './validate.ts';
import type { HistoryView } from './types.ts';

const KEY = 'model2blueprint-last-view';
interface LastView { id: string; view: HistoryView; time: number }

/** Only the small camera snapshot is synchronous, including the last frame before reload. */
export function rememberView(value: LastView): void {
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* IndexedDB remains the primary store. */ }
}
export function lastView(id: string): LastView | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null') as LastView | null;
    if (value?.id === id && Number.isFinite(value.time) && ['original', 'result'].includes(value.view.mode)
      && (!value.view.camera || validCamera(value.view.camera)) && (!value.view.navigation || validSpeeds(value.view.navigation))
      && (!value.view.navigationProfiles || validProfiles(value.view.navigationProfiles))) return value;
  } catch { /* A damaged or unavailable optional view cache is ignored. */ }
}
export function forgetView(id: string): void {
  try { if (lastView(id)) localStorage.removeItem(KEY); } catch { /* Storage may be disabled. */ }
}
