import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'];
interface ScaleGestureEvent extends Event { readonly scale: number; readonly shiftKey: boolean; readonly altKey: boolean; readonly metaKey: boolean }

/** Trackpad dolly is continuous; ordinary wheel input remains owned by OrbitControls. */
export class OrbitPinchZoom {
  private targetLogDistance?: number;
  private gestureScale?: number;
  private offset = new Vector3();
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private camera: PerspectiveCamera, private controls: OrbitControls, private canvas: HTMLCanvasElement,
    private enabled: () => boolean) {
    canvas.addEventListener('wheel', this.wheel, { capture: true, passive: false });
    for (const type of GESTURE_EVENTS) canvas.addEventListener(type, this.gesture, { capture: true, passive: false });
    controls.addEventListener('start', this.reset);
    window.addEventListener('blur', this.reset); document.addEventListener('visibilitychange', this.reset);
  }
  private available(): boolean { return this.enabled() && this.controls.enabled && this.controls.enableZoom && !document.hidden; }
  private consume(event: Event): void { event.preventDefault(); event.stopImmediatePropagation(); }
  private wheel = (event: WheelEvent): void => {
    if (!this.available() || !event.ctrlKey || event.metaKey || event.altKey) return;
    this.consume(event);
    if (this.gestureScale !== undefined) return;
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.canvas.clientHeight : 1);
    this.queue(pixels * 0.01 * (event.shiftKey ? 1 / 3 : 1));
  };
  private gesture = (event: Event): void => {
    if (event.type === 'gestureend') {
      if (this.gestureScale !== undefined && this.available()) this.consume(event);
      this.gestureScale = undefined; return;
    }
    const gesture = event as ScaleGestureEvent;
    if (!this.available() || gesture.metaKey || gesture.altKey) return;
    this.consume(event);
    if (!Number.isFinite(gesture.scale) || gesture.scale <= 0) return;
    if (event.type === 'gesturechange' && this.gestureScale !== undefined) {
      this.queue((Math.log(this.gestureScale) - Math.log(gesture.scale)) * (gesture.shiftKey ? 1 / 3 : 1));
    }
    this.gestureScale = gesture.scale;
  };
  private queue(logRatio: number): void {
    if (!Number.isFinite(logRatio) || logRatio === 0) return;
    const distance = this.camera.position.distanceTo(this.controls.target);
    if (!Number.isFinite(distance) || distance <= 0) return;
    const min = Math.max(1e-6, this.controls.minDistance);
    const max = Math.max(min, Math.min(Number.MAX_VALUE, this.controls.maxDistance));
    this.targetLogDistance = Math.max(Math.log(min), Math.min(Math.log(max), (this.targetLogDistance ?? Math.log(distance)) + logRatio));
  }
  update(delta: number): void {
    if (!this.available()) { this.reset(); return; }
    if (this.targetLogDistance === undefined) return;
    this.offset.subVectors(this.camera.position, this.controls.target);
    const distance = this.offset.length();
    if (!Number.isFinite(distance) || distance <= 0) { this.reset(); return; }
    const current = Math.log(distance), difference = this.targetLogDistance - current;
    const finish = this.reducedMotion.matches || Math.abs(difference) < 1e-4;
    const next = finish ? this.targetLogDistance : current + difference * -Math.expm1(-30 * delta);
    this.camera.position.copy(this.controls.target).addScaledVector(this.offset, Math.exp(next) / distance);
    if (finish) this.targetLogDistance = undefined;
  }
  reset = (): void => { this.targetLogDistance = undefined; this.gestureScale = undefined; };
  dispose(): void {
    this.reset();
    this.canvas.removeEventListener('wheel', this.wheel, true);
    for (const type of GESTURE_EVENTS) this.canvas.removeEventListener(type, this.gesture, true);
    this.controls.removeEventListener('start', this.reset);
    window.removeEventListener('blur', this.reset); document.removeEventListener('visibilitychange', this.reset);
  }
}
