import type { FallingData, MaterialColors, VoxelResult } from './types.ts';
import { SHAPE_BOXES, SHAPE_MASKS } from './block-shapes.ts';
import { colorSlots, shapeSlot, srgbLinear } from './colors.ts';

// Hidden interior cells never contribute to the visible animation. All exported cells remain intact.
export function fallingBlocks(result: VoxelResult, colors: MaterialColors[], limit = 500_000): FallingData | undefined {
  const { width, height, length } = result.size, plane = width * length, shapes = result.shapes;
  let cells = new Uint32Array(Math.min(65536, limit)), count = 0, pieces = 0;
  for (let y = 0; y < height; y++) for (let z = 0; z < length; z++) for (let x = 0; x < width; x++) {
    const id = x + z * width + y * plane, shape = shapes[id];
    if (!shape) continue;
    const exposed = shape !== 3 || x === 0 || x === width - 1 || z === 0 || z === length - 1 || y === 0 || y === height - 1 ||
      shapes[id - 1] !== 3 || shapes[id + 1] !== 3 || shapes[id - width] !== 3 || shapes[id + width] !== 3 ||
      (SHAPE_MASKS[shapes[id - plane]] & 240) !== 240 || (SHAPE_MASKS[shapes[id + plane]] & 15) !== 15;
    if (!exposed) continue;
    pieces += SHAPE_BOXES[shape].length;
    if (pieces > limit) return undefined;
    if (count === cells.length) { const grown = new Uint32Array(Math.min(limit, cells.length * 2)); grown.set(cells); cells = grown; }
    cells[count++] = id;
  }
  if (!count) return undefined;
  const centers = new Float32Array(pieces * 3), sizes = new Float32Array(pieces * 3);
  const anchors = new Float32Array(pieces * 3), colorData = new Float32Array(pieces * 3);
  const linearColors = colors.map(color => colorSlots(color).map(slot => slot.map(srgbLinear)));
  let piece = 0;
  for (let i = 0; i < count; i++) {
    const id = cells[i], y = Math.floor(id / plane), remainder = id - y * plane, z = Math.floor(remainder / width), x = remainder - z * width;
    for (const box of SHAPE_BOXES[shapes[id]]) {
      centers.set([x + box.center[0], y + box.center[1], z + box.center[2]], piece * 3);
      sizes.set(box.size, piece * 3); anchors.set([x + 0.5, y + 0.5, z + 0.5], piece * 3);
      colorData.set(linearColors[result.materials[id]]?.[shapeSlot(shapes[id])] ?? [0.5, 0.5, 0.5], piece * 3); piece++;
    }
  }
  return { centers, sizes, anchors, colors: colorData };
}
