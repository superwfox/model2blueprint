<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { Viewer } from '../../adapters/renderer/viewer.ts';

const emit = defineEmits<{ ready: [viewer: Viewer | undefined] }>();
const props = defineProps<{ navigationEnabled: boolean }>();
const container = ref<HTMLElement>();
let viewer: Viewer | undefined;
watch(() => props.navigationEnabled, enabled => viewer?.setNavigationEnabled(enabled));
function dispose(): void { viewer?.dispose(); viewer = undefined; }
onMounted(() => {
  try { viewer = new Viewer(container.value!); } catch { /* Slices and export remain available without WebGL. */ }
  viewer?.setNavigationEnabled(props.navigationEnabled);
  emit('ready', viewer); window.addEventListener('beforeunload', dispose);
});
onBeforeUnmount(() => { window.removeEventListener('beforeunload', dispose); dispose(); });
async function settle(): Promise<void> { await Promise.all(container.value?.getAnimations().map(animation => animation.finished.catch(() => {})) ?? []); }
defineExpose({ settle });
</script>

<template><div id="viewport" ref="container"></div></template>
