import type { WorkerProgress, WorkerReply, WorkerRequest, WorkerSuccess } from './protocol.ts';

/** One worker per task. The caller retains its input buffers for reuse. */
export class WorkerClient {
  private abort?: () => void;
  private disposed = false;

  run(job: WorkerRequest, progress: (message: WorkerProgress) => void): Promise<WorkerSuccess> {
    if (this.disposed) return Promise.reject(new DOMException('工作区已关闭', 'AbortError'));
    if (this.abort) return Promise.reject(new Error('已有任务正在处理。'));
    return new Promise((resolve, reject) => {
      const current = new Worker(new URL('./entry.ts', import.meta.url), { type: 'module' });
      let settled = false;
      const finish = () => {
        settled = true;
        current.onmessage = null; current.onerror = null; current.onmessageerror = null;
        current.terminate(); this.abort = undefined;
      };
      this.abort = () => { if (!settled) { finish(); reject(new DOMException('已取消', 'AbortError')); } };
      current.onmessage = (event: MessageEvent<WorkerReply>) => {
        if (settled) return;
        const message = event.data;
        if (message.type === 'progress') { progress(message); return; }
        finish();
        if (message.type === 'error') { reject(new Error(message.message)); return; }
        const expected = { convert: 'done', remesh: 'surface', export: 'exported' }[job.type];
        if (message.type !== expected) reject(new Error('后台任务返回了不匹配的结果。'));
        else resolve(message);
      };
      current.onerror = event => {
        if (settled) return;
        finish(); reject(new Error(event.message || '处理失败，请减小尺寸后重试。'));
      };
      current.onmessageerror = () => {
        if (settled) return;
        finish(); reject(new Error('无法读取后台处理结果，请重试。'));
      };
      // Do not transfer the canonical model or voxel buffers out of the workspace.
      try { current.postMessage(job); } catch (error) { finish(); reject(error); }
    });
  }

  cancel(): void { this.abort?.(); }
  dispose(): void { this.disposed = true; this.cancel(); }
}
