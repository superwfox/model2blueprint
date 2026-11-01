import type { BlockFamily, GridSize, ManualVariants, ModelData, SurfaceData, Vec3, VoxelResult } from '../../core/types.ts';
import type { MovementSpeeds, NavigationProfiles } from '../renderer/navigation-types.ts';
import type { BuildingChunk, BuildingDocument } from '../../core/building.ts';

export interface CameraState { position: Vec3; target: Vec3; near: number; far: number; maxDistance: number }
export interface HistoryView { mode: 'original' | 'result'; camera?: CameraState; navigation?: MovementSpeeds; navigationProfiles?: NavigationProfiles }
export interface HistoryEntry {
  kind?: 'building';
  id: string; filename: string; createdAt: number; updatedAt: number;
  dimensions: Pick<GridSize, 'width' | 'height' | 'length'>; blocks: number;
  view: HistoryView; viewUpdatedAt: number; format: 1; dataVersion: number;
}
export interface HistoryPalette { horizontalSize: string; families: BlockFamily[]; manual: ManualVariants[] }
export interface HistorySource { blob: Blob; model: ModelData }
export interface HistorySnapshot {
  entry: HistoryEntry; source: HistorySource; palette: HistoryPalette; result: VoxelResult; surface: SurfaceData;
}
export interface HistoryWrite {
  entry: HistoryEntry; palette: HistoryPalette; result: VoxelResult; surface: SurfaceData;
  source?: HistorySource; geometry: boolean;
}
export interface HistoryBootstrap { entries: HistoryEntry[]; activeId?: string }
export type BuildingMetadata = Omit<BuildingDocument, 'base' | 'chunks' | 'generated'>;
export interface BuildingSnapshot { entry: HistoryEntry; document: BuildingDocument; baseSurface?: SurfaceData }
export interface BuildingWrite {
  entry: HistoryEntry; metadata: BuildingMetadata; chunks: { key: string; chunk?: BuildingChunk }[];
  generated: { key: string; chunk?: BuildingChunk }[];
  base?: VoxelResult; baseSurface?: SurfaceData; create: boolean;
}
