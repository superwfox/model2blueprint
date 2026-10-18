// Pass a continuous pulse through the existing track cells; their centers stay fixed.
const DEFAULT_RATE = 1.4;
const ACCELERATION_RATE = 2;

export class UploadFrame {
  private position = 7;
  private speed = 0.65 * DEFAULT_RATE;
  private progress = 0;
  private working = false;
  private workingTime = 0;
  private slowing = false;
  private centers: [number, number][] = [];
  private pieces: SVGRectElement[] = [];
  private painted = new Set<number>();
  private paintedPosition = -1;
  private visible = true;
  private last = performance.now();
  private animation = 0;
  private observer: ResizeObserver;
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  constructor(private svg: SVGSVGElement) {
    this.observer = new ResizeObserver(() => this.layout()); this.observer.observe(svg);
    this.layout(); this.tick();
  }
  setWorking(value: boolean): void {
    this.working = value;
    if (value) { this.progress = 0; this.workingTime = 0; this.slowing = false; }
    else this.slowing = true;
  }
  setProgress(value: number): void {
    this.progress = Math.max(this.progress, Math.min(1, value));
    if (this.progress >= 0.92) this.slowing = true;
  }
  finish(): void {
    this.setProgress(1);
    this.setWorking(false);
  }
  setVisible(value: boolean): void {
    if (this.visible === value) return;
    this.visible = value;
    if (value) { this.last = performance.now(); this.tick(); }
    else { cancelAnimationFrame(this.animation); this.animation = 0; }
  }
  private layout(): void {
    const { width, height } = this.svg.getBoundingClientRect(); if (!width || !height) return;
    const columns = Math.max(8, Math.floor(width / 16)), rows = Math.max(8, Math.floor(height / 16));
    const stepX = (width - 16) / (columns - 1), stepY = (height - 16) / (rows - 1), points: number[][] = [];
    for (let x = 2; x < columns - 2; x++) points.push([x, 0]);
    points.push([columns - 2, 1]);
    for (let y = 2; y < rows - 2; y++) points.push([columns - 1, y]);
    points.push([columns - 2, rows - 2]);
    for (let x = columns - 3; x >= 2; x--) points.push([x, rows - 1]);
    points.push([1, rows - 2]);
    for (let y = rows - 3; y >= 2; y--) points.push([0, y]);
    points.push([1, 1]);
    const previousCount = this.centers.length;
    this.centers = points.map(([x, y]) => [8 + x * stepX, 8 + y * stepY]);
    if (previousCount) this.position = this.position / previousCount * this.centers.length;
    const pixels = this.centers.map(([x, y]) => `<rect x="${x - 5}" y="${y - 5}" width="10" height="10"/>`).join('');
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.svg.innerHTML = `<g class="frame-base">${pixels}</g>`;
    this.pieces = [...this.svg.querySelectorAll<SVGRectElement>('.frame-base rect')];
    this.painted.clear();
    this.paintedPosition = -1;
    this.paint();
  }
  private paint(): void {
    const count = this.centers.length; if (!count) return;
    if (this.position === this.paintedPosition) return;
    const head = Math.floor(this.position), changed = new Set(this.painted), active = new Set<number>();
    for (let offset = -2; offset <= 5; offset++) changed.add((head - offset + count) % count);
    changed.forEach(i => {
      // A short leading edge and a longer tail give each cell a soft rise and release.
      const distance = (this.position - i + count + 1.25) % count - 1.25;
      const t = Math.min(1, Math.abs(distance) / (distance < 0 ? 1.25 : 4.75));
      const strength = 1 - t * t * t * (t * (t * 6 - 15) + 10);
      const piece = this.pieces[i], size = 10 + 12 * strength, [x, y] = this.centers[i];
      piece.setAttribute('x', String(x - size / 2)); piece.setAttribute('y', String(y - size / 2));
      piece.setAttribute('width', String(size)); piece.setAttribute('height', String(size));
      piece.style.fill = strength > 0 ? `color-mix(in srgb, currentColor, #f1ffd6 ${strength * 100}%)` : '';
      piece.style.setProperty('--snake-light', String(strength));
      piece.classList.toggle('snake-cell', strength > 0);
      if (strength > 0) active.add(i);
    });
    this.painted = active;
    this.paintedPosition = this.position;
  }
  private tick = (): void => {
    const now = performance.now(), dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    const idle = 0.65 * DEFAULT_RATE;
    let target = idle;
    if (this.working && !this.slowing) {
      this.workingTime += dt;
      // Keep increasing throughout the job instead of jumping to one fixed working speed.
      const t = this.workingTime * ACCELERATION_RATE;
      target = idle + 35 * DEFAULT_RATE * (1 - Math.exp(-(0.035 * t + 0.002 * t * t)));
    }
    this.speed += (target - this.speed) * (1 - Math.exp(-dt / (this.slowing ? 0.6 : 0.4)));
    if (!this.reduced.matches && this.centers.length) this.position = (this.position + this.speed * dt) % this.centers.length;
    this.paint();
    this.animation = requestAnimationFrame(this.tick);
  };
  dispose(): void { cancelAnimationFrame(this.animation); this.observer.disconnect(); }
}
