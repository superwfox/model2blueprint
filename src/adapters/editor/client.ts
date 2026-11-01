import type { BuildingDocument, BuildingDelta } from '../../core/building.ts';
import type { BuildingCommand } from '../../core/building-commands.ts';
import type { ChunkSurface, EditorReply, EditorRequest } from './protocol.ts';

/** A worker belongs to one building session; canonical buffers remain on the main thread. */
export class EditorClient {
  private worker: Worker;
  private disposed = false;
  private sequence = 0;
  private pending = new Map<number, { resolve: (bytes: Uint8Array) => void; reject: (reason: Error) => void }>();
  private commands = new Map<number, { resolve: (reply: { delta?: BuildingDelta; chunks: ChunkSurface[] }) => void; reject: (reason: Error) => void }>();
  constructor(document: BuildingDocument, meshes: (chunks: ChunkSurface[]) => void, failure: (message: string) => void, baseTriangles = 0) {
    this.worker = new Worker(new URL('./entry.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<EditorReply>) => {
      if (this.disposed) return;
      const reply = event.data;
      if (reply.type === 'meshes') meshes(reply.chunks);
      else if (reply.type === 'changed') { this.commands.get(reply.requestId)?.resolve(reply); this.commands.delete(reply.requestId); }
      else if (reply.type === 'exported') { this.pending.get(reply.requestId)?.resolve(reply.bytes); this.pending.delete(reply.requestId); }
      else {
        if (reply.requestId !== undefined) {
          this.pending.get(reply.requestId)?.reject(new Error(reply.message)); this.pending.delete(reply.requestId);
          this.commands.get(reply.requestId)?.reject(new Error(reply.message)); this.commands.delete(reply.requestId);
        }
        failure(reply.message);
      }
    };
    this.worker.onerror = event => this.fail(event.message || '建筑后台处理失败。', failure);
    this.worker.onmessageerror = () => this.fail('无法读取建筑后台结果。', failure);
    try { this.post({ type: 'init', document, baseTriangles }); } catch (reason) { this.dispose(); throw reason; }
  }
  private fail(message: string, failure: (message: string) => void): void { this.dispose(); failure(message); }
  private post(job: EditorRequest): void {
    if (this.disposed) throw new Error('建筑后台已关闭，请重新打开该建筑。');
    this.worker.postMessage(job);
  }
  command(command: BuildingCommand): Promise<{ delta?: BuildingDelta; chunks: ChunkSurface[] }> {
    return new Promise((resolve, reject) => {
      const requestId = ++this.sequence; this.commands.set(requestId, { resolve, reject });
      try { this.post({ type: 'command', command, requestId }); } catch (reason) { this.commands.delete(requestId); reject(reason); }
    });
  }
  export(): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const requestId = ++this.sequence; this.pending.set(requestId, { resolve, reject });
      try { this.post({ type: 'export', requestId }); } catch (reason) { this.pending.delete(requestId); reject(reason); }
    });
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null; this.worker.terminate();
    for (const job of this.pending.values()) job.reject(new Error('建筑后台已关闭。')); this.pending.clear();
    for (const job of this.commands.values()) job.reject(new Error('建筑后台已关闭。')); this.commands.clear();
  }
}
