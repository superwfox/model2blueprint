// Independent, read-only NBT decoder used by checks, not shipped to the browser.
export function readNbt(bytes: Uint8Array): { name: string; value: Record<string, any>; consumed: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const byte = () => view.getUint8(offset++);
  const short = () => { const v = view.getUint16(offset); offset += 2; return v; };
  const int = () => { const v = view.getInt32(offset); offset += 4; return v; };
  const string = () => { const n = short(); const s = new TextDecoder().decode(bytes.subarray(offset, offset + n)); offset += n; return s; };
  const payload = (type: number): any => {
    if (type === 1) return byte();
    if (type === 2) return short();
    if (type === 3) return int();
    if (type === 7) { const n = int(); const v = bytes.slice(offset, offset + n); offset += n; return v; }
    if (type === 8) return string();
    if (type === 9) { const child = byte(), n = int(); return Array.from({ length: n }, () => payload(child)); }
    if (type === 10) {
      const result: Record<string, unknown> = {};
      for (let t = byte(); t !== 0; t = byte()) { const name = string(); result[name] = payload(t); }
      return result;
    }
    if (type === 11) return Array.from({ length: int() }, int);
    throw new Error(`Unexpected NBT tag ${type}`);
  };
  if (byte() !== 10) throw new Error('NBT root must be compound');
  const name = string(), value = payload(10);
  if (offset !== bytes.length) throw new Error('Unexpected trailing bytes');
  return { name, value, consumed: offset };
}

export function readVarInts(bytes: Uint8Array): number[] {
  const ids: number[] = [];
  for (let i = 0; i < bytes.length;) {
    let value = 0, shift = 0, b: number;
    do { if (i >= bytes.length || shift > 28) throw new Error('Invalid varint'); b = bytes[i++]; value |= (b & 127) << shift; shift += 7; } while (b & 128);
    ids.push(value);
  }
  return ids;
}
