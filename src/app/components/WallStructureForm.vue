<script setup lang="ts">
import WallPatternEditor from './WallPatternEditor.vue';
import { STRUCTURE_LABELS } from '../../core/brush-types.ts';
import type { WallStructure, WallStructureKind } from '../../core/brush-types.ts';
const structure = defineModel<WallStructure>({ required: true });
defineProps<{ selected: string; disabled: boolean; index: number }>();
const emit = defineEmits<{ remove: [] }>();
function changeKind(event: Event): void {
  const kind = (event.target as HTMLSelectElement).value as WallStructureKind;
  structure.value = { ...structure.value, kind, name: STRUCTURE_LABELS[kind] };
}
</script>
<template>
  <section class="wall-structure-card" :aria-label="'结构 ' + (index + 1) + '：' + STRUCTURE_LABELS[structure.kind]">
    <div class="structure-heading">
      <label class="structure-enabled" :title="structure.enabled ? '停用结构' : '启用结构'"><input v-model="structure.enabled" type="checkbox" :disabled="disabled" :aria-label="'启用结构 ' + (index + 1)" /></label>
      <span class="structure-number">{{ index + 1 }}</span>
      <select :value="structure.kind" :disabled="disabled" :aria-label="'结构 ' + (index + 1) + ' 类型'" @change="changeKind"><option v-for="(label, kind) in STRUCTURE_LABELS" :key="kind" :value="kind">{{ label }}</option></select>
      <button type="button" class="brush-action structure-remove" :disabled="disabled" :aria-label="'删除结构 ' + (index + 1)" title="删除结构" @click="emit('remove')">×</button>
    </div>
    <div class="structure-settings">
      <label>厚度<input v-model.number="structure.thickness" type="number" min="1" max="65535" :disabled="disabled" /></label>
      <label class="brush-checkbox"><input v-model="structure.hollow" type="checkbox" :disabled="disabled" />空心</label>
      <label v-if="structure.kind !== 'wall'" :title="structure.kind === 'station' ? '每经过多少次完整墙面循环后插入；1 表示每轮插入' : '沿路径每隔多少格设置支撑，图案以该位置居中，偶数列偏向前进方向'">间隔<input v-model.number="structure.every" type="number" min="1" max="65535" :disabled="disabled" /></label>
      <label :title="structure.kind === 'station' ? '插入位置的循环序号偏移' : '沿路径的格数偏移'">偏移<input v-model.number="structure.offset" type="number" min="-65535" max="65535" :disabled="disabled" /></label>
    </div>
    <WallPatternEditor v-model="structure.pattern" :selected="selected" :disabled="disabled" :label="'结构 ' + (index + 1) + ' ' + STRUCTURE_LABELS[structure.kind]" />
  </section>
</template>
