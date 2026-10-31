<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { optionFor } from '../../core/palette.ts';
import { kinds, kindNames, optionGroups, options, selectionTitle, thumbnailStyle } from '../material-options.ts';
import type { BlockFamily, BlockKind, BlockOption, ManualVariants, SourceMaterial } from '../../core/types.ts';

const props = defineProps<{ active: boolean; busy: boolean; materials: SourceMaterial[]; families: BlockFamily[]; manual: ManualVariants[] }>();
const emit = defineEmits<{ change: [index: number, kind: BlockKind, choice: BlockOption] }>();
const search = ref('');
watch(() => props.materials, () => { search.value = ''; });
const rows = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  return props.materials.map((material, index) => ({ material, index,
    fields: kinds.map(kind => {
      const family = props.families[index], selected = optionFor(family, kind);
      return { kind, selected, title: selectionTitle(family, props.manual[index], kind), groups: optionGroups(kind, selected, query) };
    }),
  }));
});
function change(event: Event, index: number, kind: BlockKind): void {
  const choice = options[kind].find(block => block.id === (event.target as HTMLSelectElement).value);
  if (choice) emit('change', index, kind, choice);
}
</script>

<template>
  <section id="material-panel" class="panel" :hidden="!active">
    <div class="panel-heading"><span>材质映射</span><span id="material-count" class="panel-meta">{{ materials.length }} 种材质</span></div>
    <input id="block-search" v-model="search" type="search" placeholder="搜索方块名称或 ID" aria-label="搜索方块" autocomplete="off" :disabled="busy" />
    <div class="shape-headings" aria-hidden="true"><span>方块</span><span>半砖</span><span>楼梯</span><span>展示架</span></div>
    <div id="material-list">
      <div v-for="row in rows" :key="row.index" class="material-row">
        <div class="material-source">
          <span class="swatch" :style="{ backgroundColor: `rgb(${row.material.color.join(',')})` }"></span>
          <label :for="`material-${row.index}-full`" :title="row.material.name">{{ row.material.name }}</label>
        </div>
        <div class="material-fields">
          <div v-for="field in row.fields" :key="field.kind" class="material-field">
            <span class="shape-label">{{ kindNames[field.kind] }}</span>
            <div class="material-control">
              <span class="material-thumb" :title="field.selected.label" aria-hidden="true" :style="thumbnailStyle(field.selected)"></span>
              <select :id="`material-${row.index}-${field.kind}`" :aria-label="`${row.material.name}：${kindNames[field.kind]}`"
                :value="field.selected.id" :title="field.title" :disabled="busy" @change="change($event, row.index, field.kind)">
                <optgroup v-for="group in field.groups" :key="group.label" :label="group.label">
                  <option v-for="block in group.blocks" :key="block.id" :value="block.id">{{ block.label }}</option>
                </optgroup>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
    <a class="texture-credit" href="https://modrinth.com/resourcepack/pixel-perfection-legacy" target="_blank" rel="noopener noreferrer"
      title="Pixel Perfection Legacy · XSSheep, Nova_Wostra & contributors · CC BY-SA 4.0">Pixel Perfection Legacy ↗</a>
  </section>
</template>
