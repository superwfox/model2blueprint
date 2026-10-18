import catalog from './data/block-catalog.json' with { type: 'json' };
import { srgbLinear } from './colors.ts';
import type { BlockFamily, BlockOption, SourceMaterial, Vec3 } from './types.ts';

// Generated from the user's vanilla 26.3 JAR. Only real IDs can be selected or exported.
export const FULL_BLOCKS = catalog.full as BlockOption[];
export const SLABS = catalog.slab as BlockOption[];
export const STAIRS = catalog.stairs as BlockOption[];
export const SHELVES = catalog.shelf as BlockOption[];
const slabById = new Map(SLABS.map(block => [block.id, block]));
const stairById = new Map(STAIRS.map(block => [block.id, block]));

function distance(a: Vec3, b: Vec3): number {
  return a.reduce((sum, color, axis) => {
    const delta = srgbLinear(color) - srgbLinear(b[axis]);
    return sum + delta * delta * [0.2126, 0.7152, 0.0722][axis];
  }, 0);
}

function nearest(color: Vec3, candidates: BlockOption[]): BlockOption {
  let best = candidates[0], score = Infinity;
  for (const candidate of candidates) {
    const next = distance(color, candidate.color);
    if (next < score - 1e-10 || (Math.abs(next - score) <= 1e-10 && candidate.id.startsWith('waxed_') && !best.id.startsWith('waxed_'))) {
      best = candidate; score = next;
    }
  }
  return best;
}

export const FAMILIES: BlockFamily[] = FULL_BLOCKS.map(block => {
  const slab = slabById.get(block.slab ?? '') ?? nearest(block.color, SLABS);
  const stairs = stairById.get(block.stairs ?? '') ?? nearest(block.color, STAIRS);
  const shelf = nearest(block.color, SHELVES);
  return { id: block.id, label: block.label, group: block.group, color: block.color,
    full: `minecraft:${block.state ?? block.id}`, slab: `minecraft:${slab.id}`, stairs: `minecraft:${stairs.id}`,
    shelf: `minecraft:${shelf.id}`, slabColor: slab.color, stairsColor: stairs.color, shelfColor: shelf.color };
});

export function suggestFamily(material: SourceMaterial): number {
  const eligible = FULL_BLOCKS.filter(block => block.auto !== false);
  return FULL_BLOCKS.indexOf(nearest(material.color, eligible));
}

export function optionFor(family: BlockFamily, kind: 'full' | 'slab' | 'stairs' | 'shelf'): BlockOption {
  const options = kind === 'full' ? FULL_BLOCKS : kind === 'slab' ? SLABS : kind === 'stairs' ? STAIRS : SHELVES;
  const id = family[kind].replace(/^minecraft:/, '').split('[')[0];
  return options.find(block => block.id === id)!;
}
