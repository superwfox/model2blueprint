export const MIN_FIRST_PERSON_FOV = 20, MAX_FIRST_PERSON_FOV = 100;
const KEY = 'model2blueprint-first-person-fov';

/** A browser preference, separate from model history and the orbit camera projection. */
export class FirstPersonFov {
  value = 40;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    try {
      const value = Number(localStorage.getItem(KEY));
      if (Number.isFinite(value) && value >= MIN_FIRST_PERSON_FOV && value <= MAX_FIRST_PERSON_FOV) this.value = value;
    } catch { /* Keep the in-session preference if browser storage is unavailable. */ }
  }
  set(value: number): void {
    if (!Number.isFinite(value)) return;
    this.value = Math.max(MIN_FIRST_PERSON_FOV, Math.min(MAX_FIRST_PERSON_FOV, value)); this.dirty = true;
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 250);
  }
  flush(): void {
    clearTimeout(this.timer); this.timer = undefined;
    if (!this.dirty) return;
    try { localStorage.setItem(KEY, String(this.value)); this.dirty = false; } catch { /* Preserve the current session value. */ }
  }
}
