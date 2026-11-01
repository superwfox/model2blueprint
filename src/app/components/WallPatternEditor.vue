<script setup lang="ts">
import { computed, ref } from 'vue';
import { FULL_BLOCKS } from '../../core/palette.ts';
import type { WallPattern } from '../../core/brush-types.ts';
import { trimWallPattern } from '../../core/brush-types.ts';
import { thumbnailStyle } from '../material-options.ts';
const props = defineProps<{ modelValue: WallPattern; selected: string; disabled: boolean; label: string }>();
const emit = defineEmits<{ 'update:modelValue': [pattern: WallPattern] }>();
const blocks = new Map(FULL_BLOCKS.map(block => [block.id, block]));
const hovered = ref(''), selectedBlock = computed(() => blocks.get(props.selected));
const columns = computed(() => props.modelValue.width + (props.modelValue.width < 64 ? 2 : 0));
const cells = computed(() => {
  const { width, height, cells: pattern } = props.modelValue;
  const paddingX = width < 64 ? 1 : 0, paddingY = height < 64 ? 1 : 0;
  return Array.from({ length: (width + paddingX * 2) * (height + paddingY * 2) }, (_, index) => {
    const x = index % (width + paddingX * 2) - paddingX, y = height + paddingY - 1 - Math.floor(index / (width + paddingX * 2));
    const ghost = x < 0 || x >= width || y < 0 || y >= height, id = ghost ? null : pattern[x + y * width];
    return { x, y, key: `${x},${y}`, ghost, block: id ? blocks.get(id) : undefined };
  });
});
function paint(x: number, y: number, id: string | null): void {
  if (props.disabled) return;
  const previous = props.modelValue, outside = x < 0 || x >= previous.width || y < 0 || y >= previous.height;
  if (outside && id === null) { hovered.value = ''; return; }
  if (!outside && id !== null && previous.cells[x + y * previous.width] === id) return;
  const left = x < 0 ? 1 : 0, bottom = y < 0 ? 1 : 0;
  const width = previous.width + Number(x < 0 || x >= previous.width), height = previous.height + Number(y < 0 || y >= previous.height);
  if (width > 64 || height > 64) return;
  const pattern: WallPattern = { width, height, cells: Array(width * height).fill(null) };
  for (let row = 0; row < previous.height; row++) for (let column = 0; column < previous.width; column++) {
    pattern.cells[column + left + (row + bottom) * width] = previous.cells[column + row * previous.width];
  }
  pattern.cells[x + left + (y + bottom) * width] = id;
  const next = id === null ? trimWallPattern(pattern) : pattern;
  hovered.value = '';
  if (next.width !== previous.width || next.height !== previous.height || next.cells.some((cell, i) => cell !== previous.cells[i])) emit('update:modelValue', next);
}
function fill(): void { if (!props.disabled) emit('update:modelValue', { ...props.modelValue, cells: props.modelValue.cells.map(() => props.selected) }); }
</script>
<template>
  <div class="wall-pattern">
    <div class="pattern-scroll" title="靠近边缘预览扩展，左键放置，右键设为空气并裁去空白边缘；上方为墙顶，最多 64×64" @pointerleave="hovered = ''">
      <div class="pattern-grid" :style="{ gridTemplateColumns: `repeat(${columns}, 36px)` }" :aria-label="label">
        <button v-for="cell in cells" :key="cell.key" type="button" :disabled="disabled" :class="{ empty: !cell.block, ghost: cell.ghost, 'ghost-hover': cell.ghost && hovered === cell.key }"
          :title="cell.ghost ? '左键扩展并放置，右键取消' : cell.block?.label ?? '空气'"
          :aria-label="cell.ghost ? `${label}扩展格 X${cell.x} Y${cell.y}` : `${label}第 ${cell.y + 1} 行第 ${cell.x + 1} 列：${cell.block?.label ?? '空气'}`"
          @pointerenter="hovered = cell.key" @focus="hovered = cell.key" @blur="hovered = ''"
          @click="paint(cell.x, cell.y, selected)" @contextmenu.prevent="paint(cell.x, cell.y, null)">
          <span v-if="cell.block" class="material-thumb" :style="thumbnailStyle(cell.block)"></span>
          <span v-else-if="cell.ghost && hovered === cell.key && selectedBlock" class="material-thumb" :style="thumbnailStyle(selectedBlock)"></span>
          <span v-else>{{ cell.ghost ? '+' : '·' }}</span>
        </button>
      </div>
    </div>
    <div class="pattern-tools"><span>{{ modelValue.width }} × {{ modelValue.height }}</span><span>边缘扩展 · 右键空气</span><button type="button" class="brush-action" :disabled="disabled" title="用当前方块填满图案" @click="fill">填满</button></div>
  </div>
</template>
