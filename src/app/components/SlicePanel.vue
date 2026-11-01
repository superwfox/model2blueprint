<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { drawWorldSlice, worldSliceInfo } from '../../adapters/slice.ts';
import { VoxelWorld } from '../../core/block-world.ts';
import type { BlockWorld } from '../../core/block-world.ts';
import type { BlockFamily, VoxelResult } from '../../core/types.ts';

const props = defineProps<{ active: boolean; result?: VoxelResult; world?: BlockWorld; revision?: number; families: BlockFamily[] }>();
const source = computed(() => props.world ?? (props.result ? new VoxelWorld(props.result) : undefined));
const canvas = ref<HTMLCanvasElement>(), quarter = ref(0), info = ref('');
watch(source, () => { quarter.value = 0; info.value = ''; });
function draw(): void {
  if (!props.active) return;
  if (source.value && canvas.value) { quarter.value = Math.min(quarter.value, Math.max(0, source.value.bounds.max[1] * 4 - 1)); drawWorldSlice(canvas.value, source.value, props.families, quarter.value); }
}
watch([source, () => props.families, () => props.active, () => props.revision, quarter], draw, { flush: 'post' });
onMounted(draw);
function inspect(event: MouseEvent): void {
  if (source.value && canvas.value) info.value = worldSliceInfo(canvas.value, source.value, props.families, quarter.value, event);
}
</script>

<template>
  <section id="slice-panel" class="panel" :hidden="!active">
    <div class="slice-heading"><span>水平切片</span><span id="slice-height">Y {{ quarter / 4 }}–{{ (quarter + 1) / 4 }}</span></div>
    <canvas id="slice-canvas" ref="canvas" aria-label="四分之一格高度切片" @mousemove="inspect"></canvas>
    <input id="slice-range" v-model.number="quarter" type="range" min="0" :max="source ? Math.max(0, source.bounds.max[1] * 4 - 1) : 1" step="1" aria-label="切片高度" />
    <div id="slice-info">{{ info }}</div>
  </section>
</template>
