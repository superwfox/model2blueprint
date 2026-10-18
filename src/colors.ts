import type { BlockFamily, MaterialColors, Vec3 } from './types.ts';

export const shapeSlot = (shape: number): number => shape === 1 || shape === 2 ? 1 : shape >= 4 ? 2 : 0;
export function colorSlots(colors: MaterialColors): Vec3[] {
  return Array.isArray(colors) ? [colors, colors, colors] : [colors.full, colors.slab, colors.stairs];
}
export function familyColors(family: BlockFamily): MaterialColors {
  return { full: family.color, slab: family.slabColor ?? family.color, stairs: family.stairsColor ?? family.color };
}
export const srgbLinear = (value: number): number => {
  const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
