import type { MaterialColors, MaterialTextures, SurfaceData, VoxelResult } from './types.ts';
import { BLOCK_SHAPES, isShelf, SHAPE_BOXES, SHAPE_MASKS } from './block-shapes.ts';
import { faceTiles } from './texture-data.ts';
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

type Face = [number, number, number, number, number, number, number, number]; // axis, plane, u0/u1, v0/v1, sign, paint
type Bounds = [number[], number[]];
function clip(face: Face, boxes: Bounds[]): Face[] {
  const [d, plane, , , , , sign] = face, u = (d + 1) % 3, v = (d + 2) % 3;
  let pieces = [face];
  for (const [lo, hi] of boxes) {
    if (!(sign > 0 ? lo[d] <= plane && hi[d] > plane : hi[d] >= plane && lo[d] < plane)) continue;
    const next: Face[] = [];
    for (const f of pieces) {
      const a = Math.max(f[2], lo[u]), b = Math.min(f[3], hi[u]), c = Math.max(f[4], lo[v]), e = Math.min(f[5], hi[v]);
      if (a >= b || c >= e) { next.push(f); continue; }
      if (f[2] < a) next.push([d, plane, f[2], a, f[4], f[5], sign, f[7]]);
      if (b < f[3]) next.push([d, plane, b, f[3], f[4], f[5], sign, f[7]]);
      if (f[4] < c) next.push([d, plane, a, b, f[4], c, sign, f[7]]);
      if (e < f[5]) next.push([d, plane, a, b, e, f[5], sign, f[7]]);
    }
    pieces = next;
    if (!pieces.length) break;
  }
  return pieces;
}
function mergeFaces(faces: Face[]): Face[] {
  for (const along of [4, 2, 4]) {
    const other = along === 2 ? 4 : 2, groups = new Map<string, Face[]>();
    for (const face of faces) {
      const key = [face[0], face[1], face[6], face[7], face[other], face[other + 1]].join(',');
      const group = groups.get(key); if (group) group.push(face); else groups.set(key, [face]);
    }
    faces = [];
    for (const group of groups.values()) {
      group.sort((a, b) => a[along] - b[along]); let previous: Face | undefined;
      for (const face of group) {
        if (previous && face[along] <= previous[along + 1]) previous[along + 1] = Math.max(previous[along + 1], face[along + 1]);
        else { previous = [...face]; faces.push(previous); }
      }
    }
  }
  return faces;
}

// Half-cell greedy mesh plus exact, clipped 1/16-scale shelf surfaces. One merged mesh, no per-block objects.
export function meshSurface(result: VoxelResult, colors: MaterialColors[], progress?: (n: number) => void, maxTriangles = 1_250_000, textures?: MaterialTextures[]): SurfaceData {
  const { width, height, length } = result.size;
  const dims = [width * 2, height * 2, length * 2], plane = width * length;
  const positions = new FloatBuilder(), normals = new FloatBuilder(), colorData = new FloatBuilder();
  const textureData = new FloatBuilder(), tileIds: number[] = [], shapes = BLOCK_SHAPES.length;
  const linearColors: number[][] = [], swatches = new Map<string, number>(), paint = new Uint32Array(colors.length * shapes * 6);
  colors.forEach((material, index) => {
    const slots = colorSlots(material);
    for (let shape = 0; shape < shapes; shape++) {
      const faces = textures?.[index] ? faceTiles(textures[index], shape) : [0, 0, 0, 0, 0, 0], color = slots[shapeSlot(shape)];
      faces.forEach((tile, face) => {
        const key = tile ? `tile:${tile}` : color.join(','); let id = swatches.get(key);
        if (id === undefined) { id = linearColors.length; swatches.set(key, id); linearColors.push(color.map(srgbLinear)); tileIds.push(tile); }
        paint[(index * shapes + shape) * 6 + face] = id + 1;
      });
    }
  });
  const warning = (): SurfaceData => ({ positions: new Float32Array(), normals: new Float32Array(), colors: new Float32Array(),
    warning: '表面过于复杂，已保留完整转换结果；请用切片检查或下载到 Axiom 查看。' });
  const boundsAt = (id: number): Bounds[] => {
    const y = Math.floor(id / plane), z = Math.floor((id - y * plane) / width), x = id - y * plane - z * width, origin = [x, y, z];
    return SHAPE_BOXES[result.shapes[id]].map(box => [box.center.map((c, a) => origin[a] + c - box.size[a] / 2), box.center.map((c, a) => origin[a] + c + box.size[a] / 2)]);
  };
  const emit = (face: Face): void => {
    const [d, position, a, b, c, e, sign, colorId] = face, u = (d + 1) % 3, v = (d + 2) % 3;
    const color = linearColors[colorId - 1] ?? [0.5, 0.5, 0.5];
    const corners = [[a, c], [b, c], [b, e], [a, e]], point = [0, 0, 0]; point[d] = position;
    for (const corner of sign > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) {
      point[u] = corners[corner][0]; point[v] = corners[corner][1]; positions.push(point[0], point[1], point[2]);
      normals.push(d === 0 ? sign : 0, d === 1 ? sign : 0, d === 2 ? sign : 0); colorData.push(color[0], color[1], color[2]);
      if (textures) {
        const u = d === 0 ? (sign > 0 ? -point[2] : point[2]) : d === 2 && sign < 0 ? -point[0] : point[0];
        const v = d === 1 ? (sign > 0 ? point[2] : -point[2]) : -point[1];
        textureData.push(u, v, tileIds[colorId - 1]);
      }
    }
  };
  let fineFaces: Face[] = [];
  const cell = (x: number, y: number, z: number, d: number, sign: number): number => {
    if (x < 0 || y < 0 || z < 0 || x >= dims[0] || y >= dims[1] || z >= dims[2]) return 0;
    const id = (x >> 1) + (z >> 1) * width + (y >> 1) * plane;
    const shape = result.shapes[id];
    if (isShelf(shape)) return -id - 1;
    return SHAPE_MASKS[shape] & (1 << ((x & 1) + (z & 1) * 2 + (y & 1) * 4)) ? paint[(result.materials[id] * shapes + shape) * 6 + d * 2 + (sign > 0 ? 0 : 1)] : 0;
  };
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3;
    const mask = new Int32Array(dims[u] * dims[v]);
    const cursor = [0, 0, 0];
    for (let layer = -1; layer < dims[d]; layer++) {
      let n = 0;
      for (cursor[v] = 0; cursor[v] < dims[v]; cursor[v]++) for (cursor[u] = 0; cursor[u] < dims[u]; cursor[u]++) {
        cursor[d] = layer; const a = cell(cursor[0], cursor[1], cursor[2], d, 1);
        cursor[d] = layer + 1; const b = cell(cursor[0], cursor[1], cursor[2], d, -1);
        if (a < 0 || b < 0) {
          const value = a > 0 ? a : b > 0 ? -b : 0;
          if (value) fineFaces.push(...clip([d, (layer + 1) / 2, cursor[u] / 2, (cursor[u] + 1) / 2, cursor[v] / 2, (cursor[v] + 1) / 2,
            Math.sign(value), Math.abs(value)], boundsAt(-(a < 0 ? a : b) - 1)));
          mask[n++] = 0;
        } else mask[n++] = Boolean(a) === Boolean(b) ? 0 : a ? a : -b;
      }
      for (let j = 0; j < dims[v]; j++) for (let i = 0; i < dims[u];) {
        const id = i + j * dims[u], value = mask[id];
        if (!value) { i++; continue; }
        if (positions.length / 9 + 2 > maxTriangles) return warning();
        let w = 1, h = 1;
        while (i + w < dims[u] && mask[id + w] === value) w++;
        outer: while (j + h < dims[v]) {
          for (let k = 0; k < w; k++) if (mask[id + k + h * dims[u]] !== value) break outer;
          h++;
        }
        emit([d, (layer + 1) / 2, i / 2, (i + w) / 2, j / 2, (j + h) / 2, Math.sign(value), Math.abs(value)]);
        for (let y = 0; y < h; y++) mask.fill(0, id + y * dims[u], id + y * dims[u] + w);
        i += w;
      }
      if (fineFaces.length > maxTriangles) return warning();
      progress?.((d + (layer + 2) / (dims[d] + 1)) / 3 * 0.8);
    }
  }
  for (let id = 0; id < result.shapes.length; id++) if (isShelf(result.shapes[id])) {
    const y = Math.floor(id / plane), z = Math.floor((id - y * plane) / width), x = id - y * plane - z * width;
    const own = boundsAt(id), occluders = [...own];
    for (const [valid, neighbour] of [[x > 0, id - 1], [x + 1 < width, id + 1], [z > 0, id - width], [z + 1 < length, id + width], [y > 0, id - plane], [y + 1 < height, id + plane]] as const)
      if (valid && result.shapes[neighbour]) occluders.push(...boundsAt(neighbour));
    for (const [lo, hi] of own) for (let d = 0; d < 3; d++) for (const sign of [-1, 1]) {
      const u = (d + 1) % 3, v = (d + 2) % 3;
      fineFaces.push(...clip([d, sign > 0 ? hi[d] : lo[d], lo[u], hi[u], lo[v], hi[v], sign,
        paint[(result.materials[id] * shapes + result.shapes[id]) * 6 + d * 2 + (sign > 0 ? 0 : 1)]], occluders));
    }
    if (fineFaces.length > maxTriangles) return warning();
  }
  fineFaces = mergeFaces(fineFaces);
  if (positions.length / 9 + fineFaces.length * 2 > maxTriangles) return warning();
  fineFaces.forEach(emit); progress?.(1);
  return { positions: positions.finish(), normals: normals.finish(), colors: colorData.finish(), textures: textures ? textureData.finish() : undefined };
}
