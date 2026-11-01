import type { Vec3, VoxelResult } from './types.ts';

export interface BlockBounds { min: Vec3; max: Vec3 }
export interface BlockWorld {
  readonly bounds: BlockBounds;
  shapeAt(x: number, y: number, z: number): number;
  materialAt(x: number, y: number, z: number): number;
}
export class VoxelWorld implements BlockWorld {
  readonly result: VoxelResult;
  readonly bounds: BlockBounds;
  constructor(result: VoxelResult) {
    this.result = result;
    this.bounds = { min: [0, 0, 0], max: [result.size.width, result.size.height, result.size.length] };
  }
  private index(x: number, y: number, z: number): number {
    const { width, height, length } = this.result.size;
    return x < 0 || y < 0 || z < 0 || x >= width || y >= height || z >= length ? -1 : x + z * width + y * width * length;
  }
  shapeAt(x: number, y: number, z: number): number { return this.result.shapes[this.index(x, y, z)] ?? 0; }
  materialAt(x: number, y: number, z: number): number { return this.result.materials[this.index(x, y, z)] ?? 0; }
}
export function dimensions(bounds: BlockBounds): Vec3 { return bounds.max.map((value, axis) => value - bounds.min[axis]) as Vec3; }
