import { Vector3 } from 'three';
import type { Camera } from 'three';
import { createNavigationProfiles } from './navigation-types.ts';
import type { MovementMode, MovementSpeeds, NavigationProfiles } from './navigation-types.ts';

const MOVEMENT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown']);

/** Focused-viewport movement, independent of Vue and the render loop's frame rate. */
export class KeyboardNavigation {
  private keys = new Set<string>();
  private enabled = false;
  private firstPerson = false;
  private flying = false;
  private sprinting = false;
  private lastForward = -Infinity;
  private forward = new Vector3();
  private right = new Vector3();
  private offset = new Vector3();
  private profiles = createNavigationProfiles();
  get speeds(): MovementSpeeds { return this.profiles[this.flying ? 'flying' : 'walking']; }
  getProfiles(): NavigationProfiles { return createNavigationProfiles(this.profiles.walking, this.profiles.flying); }
  setProfiles(profiles: NavigationProfiles): void { this.profiles = createNavigationProfiles(profiles.walking, profiles.flying); }
  setSpeed(mode: MovementMode, axis: keyof MovementSpeeds, value: number): void { this.profiles[mode][axis] = value; }

  constructor(private camera: Camera, private canvas: HTMLCanvasElement, private action: (kind: 'space' | 'vertical') => void) {
    canvas.tabIndex = 0;
    canvas.addEventListener('pointerdown', this.focus);
    canvas.addEventListener('keydown', this.onKeyDown);
    canvas.addEventListener('blur', this.reset);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.reset);
    document.addEventListener('visibilitychange', this.reset);
  }

  private focus = (): void => { if (this.enabled) this.canvas.focus({ preventScroll: true }); };
  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) { this.reset(); return; }
    if (!this.active || (!MOVEMENT_KEYS.has(event.code) && !(this.firstPerson && event.code === 'Space'))) return;
    event.preventDefault();
    if (event.repeat) return;
    this.keys.add(event.code);
    if (event.code === 'KeyW') {
      const now = performance.now();
      this.sprinting = now - this.lastForward <= 350; this.lastForward = now;
    }
    if (event.code === 'KeyS') this.sprinting = false;
    if (this.firstPerson && event.code === 'Space') this.action('space');
    if (this.firstPerson && (event.code === 'ArrowUp' || event.code === 'ArrowDown')) this.action('vertical');
  };
  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code); if (event.code === 'KeyW') this.sprinting = false;
  };
  reset = (): void => { this.keys.clear(); this.sprinting = false; this.lastForward = -Infinity; };
  get active(): boolean { return this.enabled && !document.hidden && document.activeElement === this.canvas; }
  pressed(code: string): boolean { return this.keys.has(code); }

  setEnabled(value: boolean): void { this.enabled = value; this.reset(); }
  setFirstPerson(value: boolean): void { if (this.firstPerson !== value) { this.firstPerson = value; this.reset(); } }
  setFlying(value: boolean): void {
    if (this.flying !== value) { this.flying = value; this.sprinting = false; this.lastForward = -Infinity; }
  }

  update(delta: number): Vector3 {
    this.offset.set(0, 0, 0);
    if (!this.active) { this.reset(); return this.offset; }
    const forward = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
    const right = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
    const up = Number(this.keys.has('ArrowUp')) - Number(this.keys.has('ArrowDown'));
    this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.right.y = 0; this.right.normalize();
    // Derive a horizontal forward vector from the camera's azimuth, even when looking straight up/down.
    this.forward.set(this.right.z, 0, -this.right.x);
    this.offset.copy(this.forward).multiplyScalar(forward).addScaledVector(this.right, right);
    const boost = this.sprinting && forward > 0 ? 1.3 : 1;
    if (this.offset.lengthSq()) this.offset.normalize().multiplyScalar(this.speeds.horizontal * boost * delta);
    this.offset.y = up * this.speeds.vertical * delta;
    return this.offset;
  }

  dispose(): void {
    this.setEnabled(false);
    this.canvas.removeEventListener('pointerdown', this.focus);
    this.canvas.removeEventListener('keydown', this.onKeyDown);
    this.canvas.removeEventListener('blur', this.reset);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.reset);
    document.removeEventListener('visibilitychange', this.reset);
  }
}
