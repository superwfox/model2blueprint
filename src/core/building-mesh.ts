import { SHAPE_BOXES } from './block-shapes.ts';
import { srgbLinear, familyColors, colorSlots, shapeSlot } from './colors.ts';
import { faceTiles, familyTextures } from './texture-data.ts';
import type { BuildingWorld } from './building.ts';
import type { SurfaceData, Vec3 } from './types.ts';

type Rectangle = [number, number, number, number];
function subtract(rectangles: Rectangle[], cut: Rectangle): Rectangle[] {
  const result: Rectangle[] = [];
  for (const [u0, u1, v0, v1] of rectangles) {
    const a = Math.max(u0, cut[0]), b = Math.min(u1, cut[1]), c = Math.max(v0, cut[2]), d = Math.min(v1, cut[3]);
    if (a >= b || c >= d) { result.push([u0, u1, v0, v1]); continue; }
    if (u0 < a) result.push([u0, a, v0, v1]); if (b < u1) result.push([b, u1, v0, v1]);
    if (v0 < c) result.push([a, b, v0, c]); if (d < v1) result.push([a, b, d, v1]);
  }
  return result;
}
/** Rebuild only edited chunks and their boundary neighbours, including exact imported shapes. */
export function meshBuildingChunk(world: BuildingWorld, key: string, maxTriangles = 1_250_000): SurfaceData {
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], textures: number[] = [];
  const origin = key.split(',').map(value => Number(value) * 16);
  const paint = world.document.families.map(family => ({ colors: colorSlots(familyColors(family)).map(color => color.map(srgbLinear)), textures: familyTextures(family) }));
  for (let index = 0; index < 4096; index++) {
    const cell: Vec3 = [origin[0] + index % 16, origin[1] + Math.floor(index / 256), origin[2] + Math.floor(index / 16) % 16];
    const shape = world.shapeAt(...cell); if (!shape) continue;
    const material = paint[world.materialAt(...cell)], tiles = faceTiles(material.textures, shape), boxes = SHAPE_BOXES[shape];
    for (const ownBox of boxes) {
    for (let axis = 0; axis < 3; axis++) for (const sign of [1, -1]) {
      const u = (axis + 1) % 3, v = (axis + 2) % 3, plane = cell[axis] + ownBox.center[axis] + sign * ownBox.size[axis] / 2, neighbor: Vec3 = [...cell]; neighbor[axis] += sign;
      let rectangles: Rectangle[] = [[cell[u] + ownBox.center[u] - ownBox.size[u] / 2, cell[u] + ownBox.center[u] + ownBox.size[u] / 2,
        cell[v] + ownBox.center[v] - ownBox.size[v] / 2, cell[v] + ownBox.center[v] + ownBox.size[v] / 2]];
      const blockers = [...boxes.filter(box => box !== ownBox).map(box => ({ box, at: cell })), ...(SHAPE_BOXES[world.shapeAt(...neighbor)] ?? []).map(box => ({ box, at: neighbor }))];
      for (const { box, at } of blockers) {
        const lo = at[axis] + box.center[axis] - box.size[axis] / 2, hi = lo + box.size[axis];
        if (!(sign > 0 ? lo <= plane + 1e-7 && hi > plane + 1e-7 : hi >= plane - 1e-7 && lo < plane - 1e-7)) continue;
        rectangles = subtract(rectangles, [at[u] + box.center[u] - box.size[u] / 2, at[u] + box.center[u] + box.size[u] / 2,
          at[v] + box.center[v] - box.size[v] / 2, at[v] + box.center[v] + box.size[v] / 2]);
      }
      for (const [u0, u1, v0, v1] of rectangles) {
        if (positions.length / 9 + 2 > maxTriangles) return { positions: new Float32Array(), normals: new Float32Array(), colors: new Float32Array(), textures: new Float32Array(),
          warning: '预览超过三角面预算，建筑数据已保留，可使用切片或下载。' };
        const corners = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
        for (const corner of sign > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) {
          const point: Vec3 = [0, 0, 0], normal: Vec3 = [0, 0, 0]; point[axis] = plane; point[u] = corners[corner][0]; point[v] = corners[corner][1]; normal[axis] = sign;
          positions.push(...point); normals.push(...normal); colors.push(...material.colors[shapeSlot(shape)]);
          const tileU = axis === 0 ? (sign > 0 ? -point[2] : point[2]) : axis === 2 && sign < 0 ? -point[0] : point[0];
          const tileV = axis === 1 ? (sign > 0 ? point[2] : -point[2]) : -point[1];
          textures.push(tileU, tileV, tiles[axis * 2 + (sign < 0 ? 1 : 0)]);
        }
      }
    }
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), colors: new Float32Array(colors), textures: new Float32Array(textures) };
}
