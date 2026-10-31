<script setup lang="ts">
import { ref, watch } from 'vue';
import ToolButton from './ToolButton.vue';
import ToolIcon from './ToolIcon.vue';
import LatticeCorners from './LatticeCorners.vue';
import type { MovementMode, NavigationState, SpeedAxis } from '../../adapters/renderer/navigation-types.ts';

const props = defineProps<{ state: NavigationState; canEnter: boolean }>();
const emit = defineEmits<{ speed: [mode: MovementMode, axis: SpeedAxis, value: number]; firstPerson: []; refresh: [] }>();
const modes: MovementMode[] = ['walking', 'flying'];
const labels = { walking: '步行', flying: '飞行' };
const axis = ref<SpeedAxis>('horizontal');
const draft = ref({ walking: String(props.state.profiles.walking.horizontal), flying: String(props.state.profiles.flying.horizontal) });
const editing = ref({ walking: false, flying: false });
function speed(mode: MovementMode): number { return props.state.profiles[mode][axis.value]; }
function valid(mode: MovementMode): boolean { return Number.isFinite(Number(draft.value[mode])) && Number(draft.value[mode]) > 0; }
function syncDrafts(): void { for (const mode of modes) if (!editing.value[mode]) draft.value[mode] = String(speed(mode)); }
watch(() => [props.state.profiles, axis.value], syncDrafts);
watch(() => [props.state.profiles, props.state.firstPerson, props.state.flying, props.state.selecting], () => emit('refresh'));
function toggle(): void {
  axis.value = axis.value === 'horizontal' ? 'vertical' : 'horizontal'; syncDrafts(); emit('refresh');
}
function input(mode: MovementMode, event: Event): void {
  draft.value[mode] = (event.target as HTMLInputElement).value;
  if (valid(mode)) emit('speed', mode, axis.value, Number(draft.value[mode]));
}
function slider(mode: MovementMode, event: Event): void {
  const value = Number((event.target as HTMLInputElement).value); draft.value[mode] = String(value); emit('speed', mode, axis.value, value);
}
function finish(mode: MovementMode): void { editing.value[mode] = false; draft.value[mode] = String(speed(mode)); }
</script>

<template>
  <div id="navigation-bar" class="lattice-frame" data-font="dynamic">
    <div class="navigation-row">
      <ToolButton class="navigation-button" :aria-label="axis === 'horizontal' ? '切换为垂直速度调整' : '切换为水平速度调整'" @click="toggle">
        <ToolIcon :name="axis === 'horizontal' ? 'horizontal' : 'vertical'" /><span>{{ axis === 'horizontal' ? '水平速度' : '垂直速度' }}</span>
      </ToolButton>
      <div v-for="mode in modes" :key="mode" class="movement-speed-group">
        <span class="movement-speed-label">{{ labels[mode] }}</span>
        <input :id="`${mode}-speed-range`" class="movement-speed-range" type="range" min="1" max="50" step="1" :value="Math.min(50, Math.max(1, speed(mode)))"
          :aria-label="`${labels[mode]}${axis === 'horizontal' ? '水平' : '垂直'}速度滑条`" @input="slider(mode, $event)" />
        <label class="navigation-speed"><input :id="`${mode}-speed`" class="movement-speed-number" type="number" min="0" step="any" :value="draft[mode]" :aria-invalid="!valid(mode)"
          :aria-label="`${labels[mode]}${axis === 'horizontal' ? '水平' : '垂直'}移动速度`" @focus="editing[mode] = true" @input="input(mode, $event)" @blur="finish(mode)" /><span>blocks/s</span></label>
      </div>
      <span class="divider"></span>
      <ToolButton id="first-person-toggle" class="navigation-button" :aria-pressed="state.firstPerson || state.selecting" :disabled="!canEnter" @click="emit('firstPerson')">
        <ToolIcon name="person" /><span>{{ state.firstPerson ? '退出第一人称' : state.selecting ? '取消落点选择' : '第一人称' }}</span>
      </ToolButton>
      <span v-if="state.firstPerson" class="navigation-mode" role="status">{{ state.flying ? '飞行' : '步行' }}</span>
    </div>
    <div v-if="state.firstPerson" class="navigation-hint">鼠标转向 · 滚轮 FOV / Shift 精细 · Space 跳跃 / 双击飞行 · ↑↓ 升降 · Esc 返回</div>
    <LatticeCorners kind="frame" />
  </div>
</template>
