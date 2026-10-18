/// <reference lib="webworker" />
import { voxelize } from './voxelize.ts';
import { meshSurface } from './surface.ts';
import { gzipSchem } from './schem.ts';
import { fallingBlocks } from './falling-data.ts';
import type { WorkerReply, WorkerRequest } from './types.ts';

const worker = self as unknown as DedicatedWorkerGlobalScope;
const reply = (message: WorkerReply, transfer: Transferable[] = []) => worker.postMessage(message, transfer);
worker.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  try {
    const job = event.data;
    let last = 0;
    const progress = (value: number, message: string) => {
      if (performance.now() - last > 70 || value >= 1) { reply({ type: 'progress', progress: value, message }); last = performance.now(); }
    };
    if (job.type === 'export') {
      progress(0.1, '生成投影文件');
      const bytes = await gzipSchem(job.result, job.families);
      progress(1, '文件已生成');
      reply({ type: 'exported', bytes }, [bytes.buffer as ArrayBuffer]);
      return;
    }
    if (job.type === 'remesh') {
      const surface = meshSurface(job.result, job.colors, n => progress(n, '更新方块材质'), undefined, job.textures);
      const buffers = [surface.positions.buffer, surface.normals.buffer, surface.colors.buffer];
      if (surface.textures) buffers.push(surface.textures.buffer);
      reply({ type: 'surface', surface }, buffers as ArrayBuffer[]);
      return;
    }
    const started = performance.now();
    const result = voxelize(job.model, job.horizontalSize, progress);
    const surface = meshSurface(result, job.colors, n => progress(0.85 + n * 0.15, '合并可见表面，准备预览'), undefined, job.textures);
    const falling = job.animate && !surface.warning ? fallingBlocks(result, job.colors, undefined, job.textures) : undefined;
    result.stats.milliseconds = performance.now() - started;
    progress(1, '转换完成');
    const buffers = [result.shapes.buffer, result.materials.buffer, surface.positions.buffer, surface.normals.buffer, surface.colors.buffer];
    if (falling) buffers.push(falling.centers.buffer, falling.sizes.buffer, falling.anchors.buffer, falling.colors.buffer);
    if (surface.textures) buffers.push(surface.textures.buffer);
    if (falling?.textures) buffers.push(falling.textures.buffer);
    reply({ type: 'done', output: { result, surface, falling } }, buffers as ArrayBuffer[]);
  } catch (error) { reply({ type: 'error', message: error instanceof Error ? error.message : '转换失败，请重新导出模型。' }); }
};
