<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import LatticeCorners from './LatticeCorners.vue';
import ToolIcon from './ToolIcon.vue';
import ToolButton from './ToolButton.vue';

const props = defineProps<{ busy: boolean; working: boolean; hasResult: boolean; progress: number }>();
const emit = defineEmits<{ choose: []; file: [file: File]; blank: [] }>();
const frame = ref<HTMLElement>(), dragover = ref(false);
const duration = computed(() => !props.working || props.progress >= 0.92 ? '3s' : `${3 - props.progress * 1.5}s`);
function onDragOver(event: DragEvent): void { event.preventDefault(); if (!props.busy) dragover.value = true; }
function onDragLeave(event: DragEvent): void { if (!event.relatedTarget) dragover.value = false; }
function onDrop(event: DragEvent): void {
  event.preventDefault(); dragover.value = false;
  const file = event.dataTransfer?.files[0]; if (file && !props.busy) emit('file', file);
}
onMounted(() => {
  document.addEventListener('dragover', onDragOver); document.addEventListener('dragleave', onDragLeave); document.addEventListener('drop', onDrop);
});
onBeforeUnmount(() => {
  document.removeEventListener('dragover', onDragOver); document.removeEventListener('dragleave', onDragLeave); document.removeEventListener('drop', onDrop);
});
async function settle(): Promise<void> { await Promise.all(frame.value?.getAnimations().map(animation => animation.finished.catch(() => {})) ?? []); }
defineExpose({ settle });
</script>

<template>
  <div id="upload-frame" ref="frame" class="lattice-frame" :class="{ dragover, 'lattice-paused': !busy && hasResult }"
    :aria-busy="working" :inert="!busy && hasResult" :style="{ '--lattice-duration': duration }">
    <button id="upload-hit" aria-label="上传 GLB" title="拖入 GLB，或点击上传" :disabled="busy" @click="emit('choose')">
      <span class="upload-eyebrow">从模型，到方块</span>
      <span class="upload-mark"><ToolIcon name="cube" /></span>
      <span class="upload-title">拖拽 GLB 到这里</span>
      <span class="upload-hint">保留建筑的轮廓与细节，转为 Minecraft 投影文件</span>
      <span class="upload-action lattice-button">选择 GLB 文件 <span aria-hidden="true">↗</span><LatticeCorners /></span>
      <span class="upload-format">GLB 2.0 <span aria-hidden="true">/</span> SPONGE SCHEMATIC V2</span>
    </button>
    <ToolButton id="blank-start" class="upload-blank" data-font="dynamic" :disabled="busy" @click="emit('blank')"><ToolIcon name="cube" /><span>从空白模板开始</span></ToolButton>
    <LatticeCorners kind="frame" />
  </div>
</template>
