import { gridSize, prepareSolids } from './geometry.ts';
import { fitShape, SHAPE_MASKS } from './block-shapes.ts';
import type { GridSize, ModelData, Solid, Vec3, VoxelResult } from './types.ts';

interface Projected {
  a: Vec3; b: Vec3; c: Vec3; area: number; solid: number; material: number;
}
interface Hit { solid: number; y: number; material: number }
interface Interval { lo: number; hi: number; lowMaterial: number; highMaterial: number }
const TILE = 8;
const orient = (a: Vec3, b: Vec3, x: number, z: number) => (b[0] - a[0]) * (z - a[2]) - (b[2] - a[2]) * (x - a[0]);
const topLeft = (a: Vec3, b: Vec3) => b[2] - a[2] > 1e-9 || (Math.abs(b[2] - a[2]) <= 1e-9 && b[0] < a[0]);

class ScanIndex {
  bins: Projected[][];
  columns: number;
  names: string[];
  constructor(solids: Solid[], size: GridSize) {
    this.columns = Math.ceil(size.width / TILE);
    this.bins = Array.from({ length: this.columns * Math.ceil(size.length / TILE) }, () => []);
    this.names = solids.map(s => s.name);
    solids.forEach((solid, solidId) => {
      for (const triangle of solid.triangles) {
        let { a, b, c } = triangle;
        let area = orient(a, b, c[0], c[2]);
        if (Math.abs(area) < 1e-12) continue; // Vertical faces do not cross vertical rays.
        if (area < 0) { [b, c] = [c, b]; area = -area; }
        const projected: Projected = { a, b, c, area, solid: solidId, material: triangle.material };
        const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]) / TILE));
        const maxX = Math.min(this.columns - 1, Math.floor(Math.max(a[0], b[0], c[0]) / TILE));
        const minZ = Math.max(0, Math.floor(Math.min(a[2], b[2], c[2]) / TILE));
        const maxZ = Math.min(Math.ceil(size.length / TILE) - 1, Math.floor(Math.max(a[2], b[2], c[2]) / TILE));
        for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) this.bins[x + z * this.columns].push(projected);
      }
    });
  }

  intervals(x: number, z: number): Interval[] {
    const candidates = this.bins[Math.floor(x / TILE) + Math.floor(z / TILE) * this.columns];
    const hits: Hit[] = [];
    for (const t of candidates) {
      const e0 = orient(t.b, t.c, x, z), e1 = orient(t.c, t.a, x, z), e2 = orient(t.a, t.b, x, z);
      // A half-open rasterization rule counts shared triangle edges exactly once.
      // A tolerance also keeps opposite caps consistent after floating-point node rotations.
      const epsilon = Math.max(1, t.area) * 1e-10;
      if (!(e0 > epsilon || (Math.abs(e0) <= epsilon && topLeft(t.b, t.c))) ||
          !(e1 > epsilon || (Math.abs(e1) <= epsilon && topLeft(t.c, t.a))) ||
          !(e2 > epsilon || (Math.abs(e2) <= epsilon && topLeft(t.a, t.b)))) continue;
      const y = (e0 * t.a[1] + e1 * t.b[1] + e2 * t.c[1]) / t.area;
      hits.push({ solid: t.solid, y, material: t.material });
    }
    hits.sort((a, b) => a.solid - b.solid || a.y - b.y);
    const intervals: Interval[] = [];
    for (let i = 0; i < hits.length;) {
      let end = i + 1;
      while (end < hits.length && hits[end].solid === hits[i].solid) end++;
      if ((end - i) % 2) throw new Error(`“${this.names[hits[i].solid]}”在扫描中出现未闭合区间，请检查自交或重叠面。`);
      for (let pair = i; pair < end; pair += 2) {
        const lo = hits[pair], hi = hits[pair + 1];
        if (hi.y - lo.y > 1e-8) intervals.push({ lo: lo.y, hi: hi.y, lowMaterial: lo.material, highMaterial: hi.material });
      }
      i = end;
    }
    return intervals.sort((a, b) => a.lo - b.lo || b.hi - a.hi);
  }
}

function addCoverage(array: Float32Array, lo: number, hi: number, stride: number, offset: number): void {
  const height = array.length / stride;
  for (let h = Math.max(0, Math.floor(lo * 2)); h < Math.min(height, Math.ceil(hi * 2 - 1e-7)); h++) {
    const overlap = Math.min(hi, (h + 1) / 2) - Math.max(lo, h / 2);
    if (overlap > 0) array[h * stride + offset] += overlap * 0.5; // Four rays per horizontal quarter; half-cell height.
  }
}

export function voxelize(model: ModelData, horizontal: number, progress?: (value: number, message: string) => void): VoxelResult {
  const start = performance.now(), size = gridSize(model, horizontal);
  progress?.(0, '检查封闭部件与顶点接缝');
  const solids = prepareSolids(model, size, n => progress?.(n * 0.12, '检查封闭部件与顶点接缝'));
  const index = new ScanIndex(solids, size);
  const { width, height, length } = size, plane = width * length, halfHeight = height * 2;
  const shapes = new Uint8Array(plane * height), materials = new Uint16Array(plane * height);
  const materialCount = model.materials.length;
  const coverage = new Float32Array(halfHeight * 4), votes = new Float32Array(halfHeight * 4 * materialCount);
  const stats = { full: 0, bottom: 0, top: 0, stairs: 0, solids: solids.length, milliseconds: 0 };
  for (let z = 0; z < length; z++) {
    for (let x = 0; x < width; x++) {
      coverage.fill(0); votes.fill(0);
      for (let sz = 0; sz < 4; sz++) for (let sx = 0; sx < 4; sx++) {
        const quarter = (sx >> 1) + (sz >> 1) * 2;
        const intervals = index.intervals(x + (sx + 0.5) / 4, z + (sz + 0.5) / 4);
        let lo = Infinity, hi = -Infinity;
        for (const interval of intervals) {
          if (interval.lo > hi + 1e-8) {
            if (hi > lo) addCoverage(coverage, lo, hi, 4, quarter);
            lo = interval.lo; hi = interval.hi;
          } else hi = Math.max(hi, interval.hi);
          const mid = (interval.lo + interval.hi) / 2;
          addCoverage(votes, interval.lo, mid, materialCount * 4, quarter * materialCount + interval.lowMaterial);
          addCoverage(votes, mid, interval.hi, materialCount * 4, quarter * materialCount + interval.highMaterial);
        }
        if (hi > lo) addCoverage(coverage, lo, hi, 4, quarter);
      }
      const centers: (Interval[] | undefined)[] = [undefined, undefined, undefined, undefined];
      for (let y = 0; y < height; y++) {
        let tieMask = 0;
        for (let bit = 0; bit < 8; bit++) {
          if (Math.abs(coverage[y * 8 + bit] - 0.5) > 1e-6) continue;
          const quarter = bit % 4, sampleY = y + (bit < 4 ? 0.25 : 0.75);
          const intervals = centers[quarter] ??= index.intervals(x + (quarter % 2) * 0.5 + 0.25, z + (quarter >> 1) * 0.5 + 0.25);
          if (intervals.some(interval => sampleY >= interval.lo && sampleY < interval.hi)) tieMask |= 1 << bit;
        }
        const shape = fitShape(coverage, y * 8, tieMask), mask = SHAPE_MASKS[shape];
        if (!shape) continue;
        const cell = x + z * width + y * plane;
        shapes[cell] = shape;
        let bestMaterial = 0, bestScore = -1;
        for (let material = 0; material < materialCount; material++) {
          let score = 0;
          for (let bit = 0; bit < 8; bit++) if (mask & (1 << bit)) score += votes[(y * 8 + bit) * materialCount + material];
          if (score > bestScore) { bestScore = score; bestMaterial = material; }
        }
        materials[cell] = bestMaterial;
        if (shape === 3) stats.full++; else if (shape === 1) stats.bottom++; else if (shape === 2) stats.top++; else stats.stairs++;
      }
    }
    progress?.(0.12 + (z + 1) / length * 0.73, '拟合方块、半砖与楼梯');
  }
  stats.milliseconds = performance.now() - start;
  return { size, shapes, materials, stats };
}
