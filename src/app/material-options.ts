import type { CSSProperties } from 'vue';
import { FULL_BLOCKS, SLABS, STAIRS, SHELVES, optionFor } from '../core/palette.ts';
import { ATLAS, blockTiles } from '../core/texture-data.ts';
import type { BlockFamily, BlockKind, BlockOption, ManualVariants } from '../core/types.ts';

export const kinds: BlockKind[] = ['full', 'slab', 'stairs', 'shelf'];
export const kindNames = { full: '完整方块', slab: '半砖', stairs: '楼梯', shelf: '展示架' };
export const options = { full: FULL_BLOCKS, slab: SLABS, stairs: STAIRS, shelf: SHELVES };

export function optionGroups(kind: BlockKind, selected: BlockOption, query: string) {
  const groups = new Map<string, BlockOption[]>();
  for (const block of options[kind]) {
    if (block.id !== selected.id && !`${block.label} ${block.id}`.toLocaleLowerCase().includes(query)) continue;
    const group = groups.get(block.group) ?? []; group.push(block); groups.set(block.group, group);
  }
  return [...groups].map(([label, blocks]) => ({ label, blocks }));
}
export function selectionTitle(family: BlockFamily, manual: ManualVariants, kind: BlockKind): string {
  const selected = optionFor(family, kind), full = FULL_BLOCKS.find(block => block.id === family.id);
  const fallback = kind !== 'full' && !manual[kind] && !full?.[kind];
  return `${selected.label}${fallback ? ' · 自动近色搭配，可单独修改' : ''}\nminecraft:${selected.id}`;
}
export function thumbnailStyle(block: BlockOption): CSSProperties {
  const tile = blockTiles(block.id)[4] || blockTiles(block.id).find(Boolean) || 0;
  const scale = 32 / ATLAS.tileSize;
  return { backgroundColor: `rgb(${block.color.join(',')})`, backgroundImage: tile ? 'url(/textures/atlas.png)' : 'none',
    backgroundSize: `${ATLAS.columns * 32}px ${ATLAS.rows * 32}px`,
    backgroundPosition: `${-(tile % ATLAS.columns) * ATLAS.tileSize * scale}px ${-Math.floor(tile / ATLAS.columns) * ATLAS.tileSize * scale}px` };
}
