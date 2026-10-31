import type { GridSize, ModelData, Solid, Triangle, Vec3 } from './types.ts';

export const MAX_CELLS = 32_000_000;

export function gridSize(model: ModelData, horizontal: number): GridSize {
  if (!Number.isInteger(horizontal) || horizontal < 1 || horizontal > 65535)
    throw new Error('最长水平边请输入 1～65535 之间的整数。');
  const extent = model.max.map((v, i) => v - model.min[i]);
  const span = Math.max(extent[0], extent[2]);
  if (!(span > 0) || !extent.every(Number.isFinite)) throw new Error('模型尺寸无效。');
  const scale = horizontal / span;
  const [width, height, length] = extent.map(v => Math.max(1, Math.ceil(v * scale - 1e-6)));
  if (Math.max(width, height, length) > 65535) throw new Error('模型某一边超过 Schem 格式的尺寸范围，请缩小尺寸。');
  if (width * height * length > MAX_CELLS)
    throw new Error(`输出约 ${(width * height * length / 1e6).toFixed(1)} 百万格，超过 3200 万格上限。请减小最长水平边。`);
  return { width, height, length, scale };
}

// Rebuild logical topology across GLB normal/UV seams, without changing the source mesh.
export function prepareSolids(model: ModelData, size: GridSize, progress?: (n: number) => void): Solid[] {
  const solids: Solid[] = [];
  for (let partIndex = 0; partIndex < model.parts.length; partIndex++) {
    const part = model.parts[partIndex];
    const vertices: Vec3[] = [], welded = new Map<string, number>();
    const remap = new Uint32Array(part.positions.length / 3);
    for (let v = 0; v < remap.length; v++) {
      const p = [0, 1, 2].map(axis => (part.positions[v * 3 + axis] - model.min[axis]) * size.scale) as Vec3;
      const key = p.map(c => Math.round(c * 1e6)).join(',');
      let id = welded.get(key);
      if (id === undefined) { id = vertices.length; vertices.push(p); welded.set(key, id); }
      remap[v] = id;
    }
    const faces: { ids: [number, number, number]; material: number }[] = [];
    for (let i = 0; i < part.indices.length; i += 3) {
      const ids = [remap[part.indices[i]], remap[part.indices[i + 1]], remap[part.indices[i + 2]]] as [number, number, number];
      if (new Set(ids).size < 3) continue;
      const [a, b, c] = ids.map(id => vertices[id]);
      const ab = sub(b, a), ac = sub(c, a), n = cross(ab, ac);
      if (dot(n, n) < 1e-20) continue;
      faces.push({ ids, material: part.materials[i / 3] });
    }
    const edges = new Map<number, { faces: number[]; directions: number[] }>();
    for (let f = 0; f < faces.length; f++) {
      const ids = faces[f].ids;
      for (let e = 0; e < 3; e++) {
        const a = ids[e], b = ids[(e + 1) % 3];
        const key = Math.min(a, b) * vertices.length + Math.max(a, b);
        let edge = edges.get(key);
        if (!edge) { edge = { faces: [], directions: [] }; edges.set(key, edge); }
        edge.faces.push(f); edge.directions.push(a < b ? 1 : -1);
      }
    }
    let boundary = 0, nonmanifold = 0;
    for (const edge of edges.values()) { if (edge.faces.length === 1) boundary++; else if (edge.faces.length !== 2) nonmanifold++; }
    if (boundary || nonmanifold || !faces.length)
      throw new Error(`“${part.name}”无法作为封闭实体：${boundary} 条开口边，${nonmanifold} 条非流形边。请在 Blender 中修复该部件；工具不会自动封洞。`);
    const adjacency: { face: number; xor: number }[][] = Array.from({ length: faces.length }, () => []);
    for (const edge of edges.values()) {
      const [a, b] = edge.faces, xor = edge.directions[0] === edge.directions[1] ? 1 : 0;
      adjacency[a].push({ face: b, xor }); adjacency[b].push({ face: a, xor });
    }
    const flips = new Int8Array(faces.length).fill(-1);
    for (let start = 0; start < faces.length; start++) {
      if (flips[start] !== -1) continue;
      const component: number[] = [], pending = [start]; flips[start] = 0;
      while (pending.length) {
        const current = pending.pop()!; component.push(current);
        for (const { face, xor } of adjacency[current]) {
          const flip = flips[current] ^ xor;
          if (flips[face] === -1) { flips[face] = flip; pending.push(face); }
          else if (flips[face] !== flip) throw new Error(`“${part.name}”的面朝向无法组成实体，请检查重叠面或自交。`);
        }
      }
      const origin = vertices[faces[start].ids[0]];
      let volume = 0;
      for (const f of component) {
        const [a, b, c] = faces[f].ids.map(id => sub(vertices[id], origin));
        volume += dot(a, cross(b, c)) * (flips[f] ? -1 : 1) / 6;
      }
      if (Math.abs(volume) < 1e-10) throw new Error(`“${part.name}”包含没有体积的封闭薄面，请先增加厚度。`);
      const triangles: Triangle[] = component.map(f => {
        const ids = [...faces[f].ids];
        if (Boolean(flips[f]) !== (volume < 0)) [ids[1], ids[2]] = [ids[2], ids[1]];
        return { a: vertices[ids[0]], b: vertices[ids[1]], c: vertices[ids[2]], material: faces[f].material };
      });
      solids.push({ name: part.name, triangles });
    }
    progress?.((partIndex + 1) / model.parts.length);
  }
  return solids;
}

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
