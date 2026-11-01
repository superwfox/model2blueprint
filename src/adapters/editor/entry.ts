/// <reference lib="webworker" />
import { BuildingWorld, dirtyChunks, neighborChunks } from '../../core/building.ts';
import { executeBuildingCommand } from '../../core/building-commands.ts';
import type { BuildingDelta } from '../../core/building.ts';
import { meshBuildingChunk } from '../../core/building-mesh.ts';
import { flattenBuilding } from '../../core/building-export.ts';
import { gzipSchem } from '../schem.ts';
import type { EditorReply, EditorRequest } from './protocol.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let world: BuildingWorld | undefined;
let triangles = 0;
const chunkTriangles = new Map<string, number>();
scope.onmessage = async (event: MessageEvent<EditorRequest>) => {
  const job = event.data;
  try {
    let keys: string[] = [];
    if (job.type === 'init') {
      world = new BuildingWorld(job.document); keys = [...new Set([...job.document.chunks.keys(), ...job.document.generated.keys()].flatMap(neighborChunks))];
      triangles = job.baseTriangles; chunkTriangles.clear();
    }
    if (!world) throw new Error('建筑编辑器尚未初始化。');
    if (job.type === 'export') {
      const bytes = await gzipSchem(flattenBuilding(world), world.document.families);
      scope.postMessage({ type: 'exported', requestId: job.requestId, bytes } satisfies EditorReply, [bytes.buffer as ArrayBuffer]); return;
    }
    let delta: BuildingDelta | undefined;
    if (job.type === 'command') {
      delta = executeBuildingCommand(world, job.command);
      if (delta) keys = [...new Set([...delta.patches.flatMap(patch => dirtyChunks(patch.position)), ...delta.generated.flatMap(write => neighborChunks(write.key))])];
    }
    const chunks = keys.map(key => {
      const previous = chunkTriangles.get(key) ?? 0; triangles -= previous;
      const surface = meshBuildingChunk(world!, key, Math.max(0, 1_250_000 - triangles));
      const count = surface.warning ? previous : surface.positions.length / 9; chunkTriangles.set(key, count); triangles += count;
      return { key, revision: world!.document.revision, surface };
    });
    const buffers = chunks.flatMap(({ surface }) => [surface.positions.buffer, surface.normals.buffer, surface.colors.buffer, surface.textures!.buffer]) as ArrayBuffer[];
    scope.postMessage(job.type === 'command' ? { type: 'changed', requestId: job.requestId, delta, chunks } satisfies EditorReply
      : { type: 'meshes', chunks } satisfies EditorReply, buffers);
  } catch (reason) {
    scope.postMessage({ type: 'error', requestId: job.type !== 'init' ? job.requestId : undefined,
      message: reason instanceof Error ? reason.message : '建筑后台处理失败。' } satisfies EditorReply);
  }
};
