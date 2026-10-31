import { SHAPE_BOXES, shapeContains } from '../core/block-shapes.ts';
import { colorSlots, familyColors, shapeSlot } from '../core/colors.ts';
import { optionFor } from '../core/palette.ts';
import type { BlockFamily, VoxelResult } from '../core/types.ts';

export function drawSlice(canvas: HTMLCanvasElement, result: VoxelResult, families: BlockFamily[], quarter: number): void {
  const { width, length } = result.size, y = Math.floor(quarter / 4), localY = (quarter % 4 + 0.5) / 4;
  const colors = families.map(family => colorSlots(familyColors(family)));
  const scale = Math.min(4, 4096 / Math.max(width, length));
  canvas.width = Math.max(1, Math.ceil(width * scale)); canvas.height = Math.max(1, Math.ceil(length * scale));
  const context = canvas.getContext('2d'); if (!context) return;
  context.fillStyle = '#040402'; context.fillRect(0, 0, canvas.width, canvas.height);
  for (let z = 0; z < length; z++) for (let x = 0; x < width; x++) {
    const cell = x + z * width + y * width * length, shape = result.shapes[cell]; if (!shape) continue;
    context.fillStyle = `rgb(${colors[result.materials[cell]][shapeSlot(shape)].join(',')})`;
    for (const box of SHAPE_BOXES[shape]) if (localY >= box.center[1] - box.size[1] / 2 && localY < box.center[1] + box.size[1] / 2)
      context.fillRect((x + box.center[0] - box.size[0] / 2) * scale, (z + box.center[2] - box.size[2] / 2) * scale, box.size[0] * scale, box.size[2] * scale);
  }
  canvas.style.aspectRatio = `${width}/${length}`;
}

export function sliceInfo(canvas: HTMLCanvasElement, result: VoxelResult, families: BlockFamily[], quarter: number, event: MouseEvent): string {
  const rect = canvas.getBoundingClientRect(), { width, length } = result.size;
  if (!rect.width || !rect.height) return '';
  const px = Math.max(0, Math.min(width - 1e-6, (event.clientX - rect.left) / rect.width * width));
  const pz = Math.max(0, Math.min(length - 1e-6, (event.clientY - rect.top) / rect.height * length));
  const x = Math.floor(px), z = Math.floor(pz), cell = x + z * width + Math.floor(quarter / 4) * width * length;
  const shape = result.shapes[cell], occupied = shapeContains(shape, px - x, (quarter % 4 + 0.5) / 4, pz - z);
  const kind = shape >= 44 ? 'shelf' : shape === 1 || shape === 2 ? 'slab' : shape >= 4 ? 'stairs' : 'full';
  return `X ${x} · Z ${z} / ${occupied ? optionFor(families[result.materials[cell]], kind).label : '空气'}`;
}
