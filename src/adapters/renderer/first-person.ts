import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { EYE_HEIGHT, WalkingCollision } from '../../core/walking.ts';
import type { Vec3 } from '../../core/types.ts';
import { FirstPersonFov, MIN_FIRST_PERSON_FOV, MAX_FIRST_PERSON_FOV } from './first-person-fov.ts';

const GRAVITY = 24, JUMP_SPEED = Math.sqrt(2 * GRAVITY * 1.25);
const GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'];
interface ScaleGestureEvent extends Event { readonly scale: number; readonly shiftKey: boolean; readonly altKey: boolean; readonly metaKey: boolean }

export class FirstPersonNavigation {
  active = false;
  flying = false;
  private pending = false;
  private promiseLock = false;
  private enabled = false;
  private disposed = false;
  private feet: Vec3 = [0, 0, 0];
  private spawn?: Vec3;
  private verticalVelocity = 0;
  private lastSpace = -Infinity;
  private orbitFov = 40;
  private fov = new FirstPersonFov();
  private gestureScale?: number;
  private direction = new Vector3();
  private look: PointerLockControls;

  constructor(private camera: PerspectiveCamera, private orbit: OrbitControls, private canvas: HTMLCanvasElement,
    readonly collision: WalkingCollision, private changed: () => void, private moved: () => void,
    private failure: (message: string) => void) {
    this.look = new PointerLockControls(camera, canvas);
    this.look.enabled = false;
    this.look.minPolarAngle = 0.01; this.look.maxPolarAngle = Math.PI - 0.01;
    this.look.addEventListener('lock', this.locked);
    this.look.addEventListener('unlock', this.unlocked);
    this.look.addEventListener('change', this.lookChanged);
    document.addEventListener('pointerlockerror', this.lockError);
    window.addEventListener('blur', this.suspend);
    document.addEventListener('visibilitychange', this.visibility);
    canvas.addEventListener('wheel', this.zoomFov, { passive: false });
    for (const type of GESTURE_EVENTS) canvas.addEventListener(type, this.zoomGesture, { passive: false });
  }
  private syncTarget(): void {
    this.camera.getWorldDirection(this.direction);
    this.orbit.target.copy(this.camera.position).addScaledVector(this.direction, 5);
  }
  private lookChanged = (): void => { if (this.active) { this.syncTarget(); this.moved(); } };
  private locked = (): void => {
    if (!this.pending || !this.enabled || this.disposed) { this.exit(); return; }
    this.pending = false; this.active = true; this.flying = false; this.verticalVelocity = 0; this.lastSpace = -Infinity;
    const damping = this.orbit.enableDamping;
    this.orbit.enableDamping = false; this.orbit.update(); this.orbit.enableDamping = damping;
    this.orbit.enabled = false;
    this.look.enabled = true;
    this.orbitFov = this.camera.fov;
    this.camera.fov = this.fov.value;
    this.feet = this.spawn ? [...this.spawn] : [this.camera.position.x, this.camera.position.y - EYE_HEIGHT, this.camera.position.z];
    this.spawn = undefined; this.collision.makeRoom(this.feet);
    this.camera.position.set(this.feet[0], this.feet[1] + EYE_HEIGHT, this.feet[2]);
    this.camera.near = 0.01; this.camera.updateProjectionMatrix(); this.syncTarget();
    this.canvas.focus({ preventScroll: true }); this.changed(); this.moved();
  };
  private unlocked = (): void => { this.exit(); };
  private lockError = (): void => { if (!this.promiseLock) this.lockFailed(); };
  private lockFailed = (): void => {
    if (!this.pending) return;
    this.exit();
    this.failure('当前浏览器未能锁定鼠标，已保留轨道视图。请在支持鼠标锁定的普通浏览器中使用第一人称。');
  };
  private suspend = (): void => { this.exit(); };
  private visibility = (): void => { if (document.hidden) this.exit(); };
  private zoomFov = (event: WheelEvent): void => {
    if (!this.active || event.metaKey || event.altKey) return;
    event.preventDefault();
    if (this.gestureScale !== undefined) return;
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.canvas.clientHeight : 1);
    // Chromium/Firefox encode trackpad pinch as Ctrl+wheel; prevent page zoom while in first person.
    if (event.ctrlKey) { this.scaleFov(Math.exp(Math.max(-1, Math.min(1, pixels * 0.01))), event.shiftKey); return; }
    const change = Math.max(-10, Math.min(10, pixels * (event.shiftKey ? 0.005 : 0.025)));
    this.setFov(this.camera.fov + change);
  };
  private zoomGesture = (event: Event): void => {
    if (event.type === 'gestureend') {
      if (this.active && this.gestureScale !== undefined) event.preventDefault();
      this.gestureScale = undefined; return;
    }
    const gesture = event as ScaleGestureEvent;
    if (!this.active || gesture.metaKey || gesture.altKey) return;
    event.preventDefault();
    if (!Number.isFinite(gesture.scale) || gesture.scale <= 0) return;
    if (event.type === 'gesturechange' && this.gestureScale !== undefined) this.scaleFov(this.gestureScale / gesture.scale, gesture.shiftKey);
    this.gestureScale = gesture.scale;
  };
  private scaleFov(ratio: number, fine: boolean): void {
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    this.setFov(2 * Math.atan(Math.tan(this.camera.fov * Math.PI / 360) * Math.pow(ratio, fine ? 0.2 : 1)) * 180 / Math.PI);
  }
  private setFov(value: number): void {
    if (!Number.isFinite(value)) return;
    const fov = Math.max(MIN_FIRST_PERSON_FOV, Math.min(MAX_FIRST_PERSON_FOV, value));
    if (fov === this.camera.fov) return;
    this.camera.fov = fov; this.fov.set(fov); this.camera.updateProjectionMatrix(); this.moved();
  }
  setEnabled(value: boolean): void { this.enabled = value; if (!value) this.exit(); }
  enter(spawn?: Vec3): void {
    if (!this.enabled || this.active || this.pending || this.disposed) return;
    this.spawn = spawn; this.pending = true;
    try {
      const request = this.canvas.requestPointerLock();
      this.promiseLock = Boolean(request);
      if (request) void request.catch(this.lockFailed);
    } catch { this.lockFailed(); }
  }
  exit(): void {
    this.fov.flush();
    this.gestureScale = undefined;
    const wasActive = this.active;
    this.pending = false; this.active = false; this.flying = false; this.look.enabled = false;
    this.verticalVelocity = 0; this.lastSpace = -Infinity; this.spawn = undefined;
    if (wasActive) {
      this.camera.fov = this.orbitFov; this.camera.updateProjectionMatrix();
      this.syncTarget(); this.orbit.enabled = true; this.orbit.update(); this.changed(); this.moved();
    }
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
  private setFlying(value: boolean): void {
    if (this.flying === value) return;
    this.flying = value; this.verticalVelocity = 0;
    if (!value) this.collision.makeRoom(this.feet);
    this.changed();
  }
  action(kind: 'space' | 'vertical'): void {
    if (!this.active) return;
    if (kind === 'vertical') { this.setFlying(true); this.moved(); return; }
    const now = performance.now();
    if (now - this.lastSpace <= 300) { this.setFlying(!this.flying); this.lastSpace = -Infinity; }
    else {
      this.lastSpace = now;
      if (!this.flying && this.collision.grounded(this.feet)) this.verticalVelocity = JUMP_SPEED;
    }
    this.moved();
  }
  update(delta: number, offset: Vector3, space: boolean, up: boolean, down: boolean, verticalSpeed: number): void {
    if (!this.active) return;
    if (this.flying) {
      this.feet[0] += offset.x; this.feet[2] += offset.z;
      const dy = (Number(space || up) - Number(down)) * verticalSpeed * delta;
      const descent = dy < 0 ? this.collision.sweep(this.feet, 1, dy) : dy;
      this.feet[1] += descent;
      // Flight ignores walls and upward obstructions; descending onto a top face returns to walking.
      if (dy < 0 && (descent > dy + 1e-7 || this.collision.grounded(this.feet))) this.setFlying(false);
    } else {
      this.collision.move(this.feet, 0, offset.x); this.collision.move(this.feet, 2, offset.z);
      this.verticalVelocity -= GRAVITY * delta;
      const dy = this.verticalVelocity * delta, actual = this.collision.move(this.feet, 1, dy);
      if (Math.abs(actual - dy) > 1e-7) this.verticalVelocity = 0;
    }
    if (this.camera.position.x !== this.feet[0] || this.camera.position.y !== this.feet[1] + EYE_HEIGHT || this.camera.position.z !== this.feet[2]) {
      this.camera.position.set(this.feet[0], this.feet[1] + EYE_HEIGHT, this.feet[2]); this.syncTarget(); this.moved();
    }
  }
  dispose(): void {
    this.disposed = true; this.exit();
    this.look.removeEventListener('lock', this.locked); this.look.removeEventListener('unlock', this.unlocked); this.look.removeEventListener('change', this.lookChanged);
    this.look.dispose(); document.removeEventListener('pointerlockerror', this.lockError);
    this.canvas.removeEventListener('wheel', this.zoomFov);
    for (const type of GESTURE_EVENTS) this.canvas.removeEventListener(type, this.zoomGesture);
    window.removeEventListener('blur', this.suspend); document.removeEventListener('visibilitychange', this.visibility);
  }
}
