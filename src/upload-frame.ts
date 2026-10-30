import { decorateLattice } from './lattice.ts';

export class UploadFrame {
  private progress = 0;

  constructor(private frame: HTMLElement) {
    decorateLattice(frame, 'frame');
  }

  setWorking(value: boolean): void {
    this.frame.setAttribute('aria-busy', String(value));
    if (value) this.progress = 0;
    this.frame.style.setProperty('--lattice-duration', '3s');
  }

  setProgress(value: number): void {
    this.progress = Math.max(this.progress, Math.min(1, value));
    // The corner sequence accelerates during work, then settles near completion.
    const duration = this.progress >= 0.92 ? 3 : 3 - this.progress * 1.5;
    this.frame.style.setProperty('--lattice-duration', `${duration}s`);
  }

  finish(): void { this.setWorking(false); }

  setVisible(value: boolean): void {
    this.frame.classList.toggle('lattice-paused', !value);
  }

  dispose(): void { this.setVisible(false); }
}
