export type Vec3 = [number, number, number];

export interface SourceMaterial {
  name: string;
  color: Vec3;
}

export interface BlockOption { id: string; label: string; color: Vec3; group: string; state?: string; slab?: string; stairs?: string; auto?: boolean }
export type MaterialColors = Vec3 | { full: Vec3; slab: Vec3; stairs: Vec3 };

export interface MeshPart {
  name: string;
  positions: Float64Array;
  indices: Uint32Array;
  materials: Uint16Array;
}

export interface ModelData {
  parts: MeshPart[];
  materials: SourceMaterial[];
  min: Vec3;
  max: Vec3;
  triangleCount: number;
}

export interface GridSize { width: number; height: number; length: number; scale: number }
export interface Triangle { a: Vec3; b: Vec3; c: Vec3; material: number }
export interface Solid { name: string; triangles: Triangle[] }

// 0 air, 1 bottom slab, 2 top slab, 3 full block; 4–43 oriented stairs (block-shapes.ts).
export interface VoxelResult {
  size: GridSize;
  shapes: Uint8Array;
  materials: Uint16Array;
  stats: { full: number; bottom: number; top: number; stairs: number; solids: number; milliseconds: number };
}

export interface BlockFamily {
  id: string;
  label: string;
  full: string;
  slab: string;
  stairs: string;
  group: string;
  color: Vec3;
  slabColor?: Vec3;
  stairsColor?: Vec3;
}

export interface SurfaceData { positions: Float32Array; normals: Float32Array; colors: Float32Array; warning?: string }
export interface FallingData { centers: Float32Array; sizes: Float32Array; anchors: Float32Array; colors: Float32Array }
export interface ConversionOutput { result: VoxelResult; surface: SurfaceData; falling?: FallingData }

export type WorkerRequest =
  | { type: 'convert'; model: ModelData; horizontalSize: number; colors: MaterialColors[]; animate?: boolean }
  | { type: 'remesh'; result: VoxelResult; colors: MaterialColors[] }
  | { type: 'export'; result: VoxelResult; families: BlockFamily[] };

export type WorkerReply =
  | { type: 'progress'; progress: number; message: string }
  | { type: 'done'; output: ConversionOutput }
  | { type: 'surface'; surface: SurfaceData }
  | { type: 'exported'; bytes: Uint8Array }
  | { type: 'error'; message: string };
