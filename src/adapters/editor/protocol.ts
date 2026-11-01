import type { BuildingDocument, BuildingDelta } from '../../core/building.ts';
import type { BuildingCommand } from '../../core/building-commands.ts';
import type { SurfaceData } from '../../core/types.ts';

export interface ChunkSurface { key: string; surface: SurfaceData; revision: number }
export type EditorRequest =
  | { type: 'init'; document: BuildingDocument; baseTriangles: number }
  | { type: 'command'; command: BuildingCommand; requestId: number }
  | { type: 'export'; requestId: number };
export type EditorReply =
  | { type: 'meshes'; chunks: ChunkSurface[] }
  | { type: 'changed'; requestId: number; delta?: BuildingDelta; chunks: ChunkSurface[] }
  | { type: 'exported'; requestId: number; bytes: Uint8Array }
  | { type: 'error'; requestId?: number; message: string };
