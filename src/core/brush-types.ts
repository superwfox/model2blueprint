import type { Vec3 } from './types.ts';

export type BrushKind = 'block' | 'wall' | 'box' | 'sphere' | 'smooth' | 'fracture';
export interface BrushSettings {
  kind: BrushKind; fixed: boolean; size: Vec3; radius: number; hollow: boolean; smoothRadius: number; strength: number; preset: string;
  fractureRadius: number; fractureScale: number; fractureWidth: number; fractureDepth: number; fractureSeed: number;
}
export interface WallPattern { width: number; height: number; cells: (string | null)[] }
/** Explicit erasing trims empty borders; holes inside the occupied rectangle remain air. */
export function trimWallPattern(pattern: WallPattern): WallPattern {
  let left = pattern.width, right = -1, bottom = pattern.height, top = -1;
  for (let y = 0; y < pattern.height; y++) for (let x = 0; x < pattern.width; x++) if (pattern.cells[x + y * pattern.width] !== null) {
    left = Math.min(left, x); right = Math.max(right, x); bottom = Math.min(bottom, y); top = Math.max(top, y);
  }
  if (right < 0) return { width: 1, height: 1, cells: [null] };
  const width = right - left + 1, height = top - bottom + 1;
  return { width, height, cells: Array.from({ length: width * height }, (_, i) => pattern.cells[left + i % width + (bottom + Math.floor(i / width)) * pattern.width]) };
}
export type WallStructureKind = 'wall' | 'station' | 'support';
export interface WallStructure {
  id: string; kind: WallStructureKind; name: string; enabled: boolean; pattern: WallPattern;
  thickness: number; hollow: boolean; every: number; offset: number;
}
export interface WallPreset { id: string; name: string; structures: WallStructure[] }
export interface WallPoint { position: Vec3; control?: Vec3 }
export interface WallNode { id: string; name: string; preset: string; points: WallPoint[]; closed: boolean; inside: boolean; outside: boolean }
export function defaultBrush(): BrushSettings {
  return { kind: 'block', fixed: false, size: [5, 5, 5], radius: 4, hollow: false, smoothRadius: 4, strength: 0.5, preset: '',
    fractureRadius: 8, fractureScale: 8, fractureWidth: 1, fractureDepth: 3, fractureSeed: 1 };
}
export function defaultPreset(id: string): WallPreset {
  return { id, name: '石墙', structures: (['wall', 'station', 'support'] as const).map((kind, index) => ({ ...defaultStructure(`${id}:${index}`, kind), enabled: kind === 'wall' })) };
}
export const STRUCTURE_LABELS: Record<WallStructureKind, string> = { wall: '循环墙面', station: '驻点墩', support: '两侧支撑' };
export function defaultStructure(id: string, kind: WallStructureKind): WallStructure {
  const width = kind === 'wall' ? 3 : 1, height = kind === 'wall' ? 4 : kind === 'station' ? 5 : 3;
  return { id, kind, name: STRUCTURE_LABELS[kind], enabled: true, thickness: kind === 'support' ? 2 : 1, hollow: false,
    every: kind === 'station' ? 1 : 6, offset: 0, pattern: { width, height, cells: Array(width * height).fill(kind === 'station' ? 'stone_bricks' : 'stone') } };
}
/** Upgrade saved v2 presets and their undo snapshots without changing IDs or wall references. */
export function upgradeWallPreset(preset: WallPreset): void {
  if (!preset || Object.hasOwn(preset, 'structures')) return;
  const old = preset as unknown as { pattern: WallPattern; thickness: number; hollow: boolean; station: WallPattern; stationEvery: number; stationEnabled: boolean; support: WallPattern; supportEvery: number; supportDepth: number; supportEnabled: boolean };
  if (!old.pattern || !old.station || !old.support) return;
  preset.structures = (['wall', 'station', 'support'] as const).map((kind, index) => ({ ...defaultStructure(`${preset.id}:${index}`, kind),
    pattern: kind === 'wall' ? old.pattern : old[kind], thickness: kind === 'support' ? old.supportDepth : old.thickness,
    hollow: kind === 'support' ? false : old.hollow, every: kind === 'station' ? old.stationEvery : kind === 'support' ? old.supportEvery : 6,
    enabled: kind === 'wall' || (kind === 'station' ? old.stationEnabled : old.supportEnabled) }));
  for (const key of ['pattern', 'thickness', 'hollow', 'station', 'stationEvery', 'stationEnabled', 'support', 'supportEvery', 'supportDepth', 'supportEnabled']) Reflect.deleteProperty(preset, key);
}
export const BRUSH_LABELS: Record<BrushKind, string> = { block: '单块放置', wall: '墙壁', box: '长方体', sphere: '球体', smooth: '平滑', fracture: '碎裂 · 龟裂' };
export const MAX_BRUSH_CELLS = 262_144;
export const WALL_LAYOUT_VERSION = 3;
export function validPoint(point: Vec3): boolean {
  return point.length === 3 && point.every(value => Number.isSafeInteger(value) && Math.abs(value) < Number.MAX_SAFE_INTEGER - 65536) && point[1] >= 0;
}
export function wallArea(node: WallNode): number {
  if (!node.closed || node.points.length < 3) return 0;
  const outline: [number, number][] = [];
  for (let i = 0; i < node.points.length; i++) {
    const a = node.points[i].position, end = node.points[(i + 1) % node.points.length], b = end.position, c = end.control;
    const steps = c ? 16 : 1;
    for (let step = 0; step < steps; step++) {
      const t = step / steps, point: [number, number] = [0, 2].map(axis => c ? (1 - t) ** 2 * a[axis] + 2 * (1 - t) * t * c[axis] + t * t * b[axis] : a[axis] + t * (b[axis] - a[axis])) as [number, number];
      if (outline.length && Math.hypot(point[0] - outline.at(-1)![0], point[1] - outline.at(-1)![1]) < 1e-8) continue;
      outline.push(point); if (outline.length > 512) return 0;
    }
  }
  const cross = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let area = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length]; area += a[0] * b[1] - b[0] * a[1];
    for (let j = i + 2; j < outline.length; j++) {
      if (i === 0 && j === outline.length - 1) continue;
      const c = outline[j], d = outline[(j + 1) % outline.length];
      if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) < Math.min(a[0], b[0]) || Math.max(a[1], b[1]) < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) < Math.min(a[1], b[1])) continue;
      if (cross(a, b, c) * cross(a, b, d) <= 1e-10 && cross(c, d, a) * cross(c, d, b) <= 1e-10) return 0;
    }
  }
  return area / 2;
}
