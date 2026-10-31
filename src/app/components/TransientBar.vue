<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';

const props = withDefaults(defineProps<{ refreshKey: number; enabled?: boolean; duration?: number; label?: string }>(),
  { enabled: true, duration: 5000, label: '快捷操作' });
const emit = defineEmits<{ visibility: [visible: boolean]; height: [height: number] }>();
const visible = ref(false), element = ref<HTMLElement>();
let timer: ReturnType<typeof setTimeout> | undefined;
let observer: ResizeObserver | undefined;
function hide(): void { clearTimeout(timer); visible.value = false; emit('visibility', false); }
function show(): void {
  if (!props.enabled) return;
  clearTimeout(timer); visible.value = true; emit('visibility', true); timer = setTimeout(hide, props.duration);
}
watch(() => props.refreshKey, show);
watch(() => props.enabled, enabled => { if (!enabled) hide(); });
onMounted(() => {
  observer = new ResizeObserver(() => emit('height', element.value?.offsetHeight ?? 0));
  if (element.value) observer.observe(element.value);
});
onBeforeUnmount(() => { clearTimeout(timer); observer?.disconnect(); });
defineExpose({ show, hide });
</script>

<template>
  <div ref="element" class="transient-bar" :class="{ shown: visible }" :aria-label="label" role="region" :aria-hidden="!visible" :inert="!visible"
    @pointerdown="show" @keydown="show" @input="show" @focusin="show"><slot /></div>
</template>
