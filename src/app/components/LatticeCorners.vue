<script setup lang="ts">
const props = withDefaults(defineProps<{ kind?: 'frame' | 'button' }>(), { kind: 'button' });
const sizes = [4, 8, 14, 8, 4], positions = [3, 11, 24, 43, 55];
function squares(end: boolean) {
  const inset = props.kind === 'button', indices = inset ? [1, 2, 3] : [0, 1, 2, 3, 4];
  let step = end ? indices.length * 2 : 0;
  return [true, false].flatMap(side => (side ? [...indices].reverse() : indices).map(index => ({
    x: side ? (inset ? 1 : 1 - sizes[index]) : positions[index],
    y: side ? positions[index] : (inset ? 1 : 1 - sizes[index]),
    size: sizes[index], side, step: step++,
  })));
}
</script>

<template>
  <svg v-for="end in [false, true]" :key="String(end)" viewBox="0 0 64 64" aria-hidden="true" focusable="false"
    class="lattice-corner" :class="{ 'lattice-end': end }">
    <g fill="none" stroke="currentColor" stroke-width="1">
      <path d="M1 63V1H63" />
      <rect v-for="square in squares(end)" :key="square.step" :x="square.x" :y="square.y" :width="square.size" :height="square.size"
        :class="{ 'lattice-side': square.side }" :style="{ '--step': square.step }" />
    </g>
  </svg>
</template>
