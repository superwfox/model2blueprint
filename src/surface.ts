import type { MaterialColors, SurfaceData, VoxelResult } from './types.ts';
import { SHAPE_MASKS } from './block-shapes.ts';
import { colorSlots, shapeSlot, srgbLinear } from './colors.ts';

class FloatBuilder {
  private buffer = new Float32Array(4096);
  length = 0;
  push(x: number, y: number, z: number): void {
    if (this.length + 3 > this.buffer.length) { const next = new Float32Array(this.buffer.length * 2); next.set(this.buffer); this.buffer = next; }
    this.buffer[this.length++] = x; this.buffer[this.length++] = y; this.buffer[this.length++] = z;
  }
  finish(): Float32Array { return this.buffer.slice(0, this.length); }
}

// Greedy mesh of half-size subcells. Slabs, stairs and full blocks share identical boundary rules.
export function meshSurface(result: VoxelResult, colors: MaterialColors[], progress?: (n: number) => void, maxTriangles = 1_000_000): SurfaceData {
  const { width, height, length } = result.size;
  const dims = [width * 2, height * 2, length * 2], plane = width * length;
  const positions = new FloatBuilder(), normals = new FloatBuilder(), colorData = new FloatBuilder();
  const linearColors: number[][] = [], swatches = new Map<string, number>(), paint = new Uint32Array(colors.length * 3);
  colors.forEach((material, index) => colorSlots(material).forEach((color, slot) => {
    const key = color.join(','); let id = swatches.get(key);
    if (id === undefined) { id = linearColors.length; swatches.set(key, id); linearColors.push(color.map(srgbLinear)); }
    paint[index * 3 + slot] = id + 1;
  }));
  const cell = (x: number, y: number, z: number): number => {
    if (x < 0 || y < 0 || z < 0 || x >= dims[0] || y >= dims[1] || z >= dims[2]) return 0;
    const id = (x >> 1) + (z >> 1) * width + (y >> 1) * plane;
    const shape = result.shapes[id];
    return SHAPE_MASKS[shape] & (1 << ((x & 1) + (z & 1) * 2 + (y & 1) * 4)) ? paint[result.materials[id] * 3 + shapeSlot(shape)] : 0;
  };
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3;
    const mask = new Int32Array(dims[u] * dims[v]);
    const cursor = [0, 0, 0];
    for (let layer = -1; layer < dims[d]; layer++) {
      let n = 0;
      for (cursor[v] = 0; cursor[v] < dims[v]; cursor[v]++) for (cursor[u] = 0; cursor[u] < dims[u]; cursor[u]++) {
        cursor[d] = layer; const a = cell(cursor[0], cursor[1], cursor[2]);
        cursor[d] = layer + 1; const b = cell(cursor[0], cursor[1], cursor[2]);
        mask[n++] = Boolean(a) === Boolean(b) ? 0 : a ? a : -b;
      }
      for (let j = 0; j < dims[v]; j++) for (let i = 0; i < dims[u];) {
        const id = i + j * dims[u], value = mask[id];
        if (!value) { i++; continue; }
        if (positions.length / 9 + 2 > maxTriangles) return { positions: new Float32Array(), normals: new Float32Array(), colors: new Float32Array(),
          warning: '表面过于复杂，已保留完整转换结果；请用切片检查或下载到 Axiom 查看。' };
        let w = 1, h = 1;
        while (i + w < dims[u] && mask[id + w] === value) w++;
        outer: while (j + h < dims[v]) {
          for (let k = 0; k < w; k++) if (mask[id + k + h * dims[u]] !== value) break outer;
          h++;
        }
        const origin = [0, 0, 0], du = [0, 0, 0], dv = [0, 0, 0];
        origin[d] = layer + 1; origin[u] = i; origin[v] = j; du[u] = w; dv[v] = h;
        const corners = [origin, origin.map((c, a) => c + du[a]), origin.map((c, a) => c + du[a] + dv[a]), origin.map((c, a) => c + dv[a])];
        const order = value > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
        const color = linearColors[Math.abs(value) - 1] ?? [0.5, 0.5, 0.5];
        for (const corner of order) {
          const p = corners[corner]; positions.push(p[0] / 2, p[1] / 2, p[2] / 2);
          normals.push(d === 0 ? Math.sign(value) : 0, d === 1 ? Math.sign(value) : 0, d === 2 ? Math.sign(value) : 0);
          colorData.push(color[0], color[1], color[2]);
        }
        for (let y = 0; y < h; y++) mask.fill(0, id + y * dims[u], id + y * dims[u] + w);
        i += w;
      }
      progress?.((d + (layer + 2) / (dims[d] + 1)) / 3);
    }
  }
  return { positions: positions.finish(), normals: normals.finish(), colors: colorData.finish() };
}
