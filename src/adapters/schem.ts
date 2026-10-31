import { encodeSchem } from '../core/schem.ts';
import type { BlockFamily, VoxelResult } from '../core/types.ts';

// Web-platform compression also runs in the Node-based verification script.
export async function gzipSchem(result: VoxelResult, families: BlockFamily[]): Promise<Uint8Array> {
  const bytes = encodeSchem(result, families);
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
