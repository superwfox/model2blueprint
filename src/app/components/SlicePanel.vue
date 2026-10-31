<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { drawSlice, sliceInfo } from '../../adapters/slice.ts';
import type { BlockFamily, VoxelResult } from '../../core/types.ts';

const props = defineProps<{ active: boolean; result?: VoxelResult; families: BlockFamily[] }>();
const canvas = ref<HTMLCanvasElement>(), quarter = ref(0), info = ref('');
watch(() => props.result, () => { quarter.value = 0; info.value = ''; });
function draw(): void { if (props.result && canvas.value) drawSlice(canvas.value, props.result, props.families, quarter.value); }
watch([() => props.result, () => props.families, () => props.active, quarter], draw, { flush: 'post' });
onMounted(draw);
function inspect(event: MouseEvent): void {
  if (props.result && canvas.value) info.value = sliceInfo(canvas.value, props.result, props.families, quarter.value, event);
}
</script>

<template>
  <section id="slice-panel" class="panel" :hidden="!active">
    <div class="slice-heading"><span>水平切片</span><span id="slice-height">Y {{ quarter / 4 }}–{{ (quarter + 1) / 4 }}</span></div>
    <canvas id="slice-canvas" ref="canvas" aria-label="四分之一格高度切片" @mousemove="inspect"></canvas>
    <input id="slice-range" v-model.number="quarter" type="range" min="0" :max="result ? result.size.height * 4 - 1 : 1" step="1" aria-label="切片高度" />
    <div id="slice-info">{{ info }}</div>
  </section>
</template>
