import type { BlockFamily, ConversionOutput, MaterialColors, MaterialTextures, ModelData, SurfaceData, VoxelResult } from '../../core/types.ts';

export type WorkerRequest =
  | { type: 'convert'; model: ModelData; horizontalSize: number; colors: MaterialColors[]; textures?: MaterialTextures[]; animate?: boolean }
  | { type: 'remesh'; result: VoxelResult; colors: MaterialColors[]; textures?: MaterialTextures[] }
  | { type: 'export'; result: VoxelResult; families: BlockFamily[] };

export type WorkerReply =
  | { type: 'progress'; progress: number; message: string }
  | { type: 'done'; output: ConversionOutput }
  | { type: 'surface'; surface: SurfaceData }
  | { type: 'exported'; bytes: Uint8Array }
  | { type: 'error'; message: string };

export type WorkerSuccess = Extract<WorkerReply, { type: 'done' | 'surface' | 'exported' }>;
export type WorkerProgress = Extract<WorkerReply, { type: 'progress' }>;
