import type { BlockFamily, VoxelResult } from './types.ts';
import { blockState, BLOCK_SHAPES } from './block-shapes.ts';

// Generated Minecraft 26.3 version metadata: https://raw.githubusercontent.com/misode/mcmeta/26.3-summary/version.json
export const DATA_VERSION = 5023;

class NbtWriter {
  private data = new Uint8Array(1024);
  private length = 0;
  private reserve(n: number): void {
    if (this.length + n <= this.data.length) return;
    const next = new Uint8Array(Math.max(this.data.length * 2, this.length + n));
    next.set(this.data); this.data = next;
  }
  byte(value: number): void { this.reserve(1); this.data[this.length++] = value; }
  short(value: number): void { this.reserve(2); new DataView(this.data.buffer).setUint16(this.length, value); this.length += 2; }
  int(value: number): void { this.reserve(4); new DataView(this.data.buffer).setInt32(this.length, value); this.length += 4; }
  bytes(value: Uint8Array): void { this.reserve(value.length); this.data.set(value, this.length); this.length += value.length; }
  name(value: string): void { const bytes = new TextEncoder().encode(value); this.short(bytes.length); this.bytes(bytes); }
  tag(type: number, name: string): void { this.byte(type); this.name(name); }
  intTag(name: string, value: number): void { this.tag(3, name); this.int(value); }
  finish(): Uint8Array { return this.data.slice(0, this.length); }
}

export function encodeSchem(result: VoxelResult, families: BlockFamily[]): Uint8Array {
  const { width, height, length } = result.size;
  if (result.shapes.length !== width * height * length || result.materials.length !== result.shapes.length)
    throw new Error('输出网格长度不一致，无法写出 Schem。');
  const palette = new Map<string, number>([['minecraft:air', 0]]);
  const states = families.map(family => BLOCK_SHAPES.map((_, shape) => blockState(family, shape)));
  const lookup = families.map(() => new Uint32Array(BLOCK_SHAPES.length));
  for (let i = 0; i < result.shapes.length; i++) {
    const shape = result.shapes[i]; if (!shape) continue;
    const material = result.materials[i];
    if (!states[material]) throw new Error('材质映射不完整，请重新转换。');
    const state = states[material][shape];
    if (!state) throw new Error('输出中包含无效方块形状。');
    let id = palette.get(state);
    if (id === undefined) { id = palette.size; palette.set(state, id); }
    lookup[material][shape] = id;
  }
  let dataLength = 0;
  for (let i = 0; i < result.shapes.length; i++) {
    let id = result.shapes[i] ? lookup[result.materials[i]][result.shapes[i]] : 0;
    do { dataLength++; id >>>= 7; } while (id);
  }
  const data = new Uint8Array(dataLength);
  let offset = 0;
  for (let i = 0; i < result.shapes.length; i++) {
    let id = result.shapes[i] ? lookup[result.materials[i]][result.shapes[i]] : 0;
    do { const rest = id >>> 7; data[offset++] = (id & 127) | (rest ? 128 : 0); id = rest; } while (id);
  }
  const writer = new NbtWriter();
  writer.tag(10, 'Schematic');
  writer.intTag('Version', 2); writer.intTag('DataVersion', DATA_VERSION);
  for (const [name, value] of [['Width', width], ['Height', height], ['Length', length]] as const) { writer.tag(2, name); writer.short(value); }
  writer.tag(11, 'Offset'); writer.int(3); writer.int(0); writer.int(0); writer.int(0);
  writer.intTag('PaletteMax', palette.size);
  writer.tag(10, 'Palette'); for (const [state, id] of palette) writer.intTag(state, id); writer.byte(0);
  writer.tag(7, 'BlockData'); writer.int(data.length); writer.bytes(data);
  for (const name of ['BlockEntities', 'Entities']) { writer.tag(9, name); writer.byte(10); writer.int(0); }
  writer.byte(0);
  return writer.finish();
}
