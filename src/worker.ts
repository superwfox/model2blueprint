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
    if (job.type === 'export') {
      const bytes = await gzipSchem(job.result, job.families);
      reply({ type: 'exported', bytes }, [bytes.buffer as ArrayBuffer]);
      return;
    }
    if (job.type === 'remesh') {
      const surface = meshSurface(job.result, job.colors);
      reply({ type: 'surface', surface }, [surface.positions.buffer, surface.normals.buffer, surface.colors.buffer] as ArrayBuffer[]);
      return;
    }
    let last = 0;
    const progress = (value: number, message: string) => {
      if (performance.now() - last > 70 || value >= 1) { reply({ type: 'progress', progress: value, message }); last = performance.now(); }
    };
    const started = performance.now();
    const result = voxelize(job.model, job.horizontalSize, progress);
    const surface = meshSurface(result, job.colors, n => progress(0.85 + n * 0.15, '合并可见表面，准备预览'));
    const falling = job.animate && !surface.warning ? fallingBlocks(result, job.colors) : undefined;
    result.stats.milliseconds = performance.now() - started;
    progress(1, '转换完成');
    const buffers = [result.shapes.buffer, result.materials.buffer, surface.positions.buffer, surface.normals.buffer, surface.colors.buffer];
    if (falling) buffers.push(falling.centers.buffer, falling.sizes.buffer, falling.anchors.buffer, falling.colors.buffer);
    reply({ type: 'done', output: { result, surface, falling } }, buffers as ArrayBuffer[]);
  } catch (error) { reply({ type: 'error', message: error instanceof Error ? error.message : '转换失败，请重新导出模型。' }); }
};
