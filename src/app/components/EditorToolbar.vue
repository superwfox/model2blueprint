<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ToolButton from './ToolButton.vue';
import ToolIcon from './ToolIcon.vue';
import LatticeCorners from './LatticeCorners.vue';
import BrushPanel from './BrushPanel.vue';
import HistoryPanel from './HistoryPanel.vue';
import { FULL_BLOCKS } from '../../core/palette.ts';
import { optionGroups, thumbnailStyle } from '../material-options.ts';
import type { BuildingWorld } from '../../core/building.ts';
import type { HistoryEntry } from '../../adapters/history/types.ts';
import { BRUSH_LABELS } from '../../core/brush-types.ts';
import type { BrushSettings, WallNode, WallPreset } from '../../core/brush-types.ts';
import { useToolbarPanels } from '../useToolbarPanels.ts';

const props = defineProps<{ world: BuildingWorld; revision: number; editing: boolean; selected: string; limit: number;
  canUndo: boolean; canRedo: boolean; count: number; saveStatus: string; busy: boolean; panelBusy: boolean; canDownload: boolean;
  history: HistoryEntry[]; currentId?: string; warning: string; brush: BrushSettings; nodes: WallNode[]; presets: WallPreset[]; selectedNode: string }>();
const emit = defineEmits<{ choose: [id: string]; limit: [value: number]; undo: []; redo: []; exit: []; resume: []; fit: []; download: [];
  restore: [id: string]; remove: [id: string]; configure: [value: BrushSettings]; preset: [value: WallPreset]; node: [value: WallNode]; selectNode: [id: string]; repick: [id: string]; removeNode: [id: string]; focusNode: [id: string] }>();
const { panel, expanded, shown, expansion, toggle: togglePanel, close, settled } = useToolbarPanels<'blocks' | 'brush' | 'history'>('blocks');
const query = ref(''), limitDraft = ref(String(props.limit));
const content = ref<HTMLElement>(), contentHeight = ref(0);
let contentObserver: ResizeObserver | undefined;
const brushPanel = ref<InstanceType<typeof BrushPanel>>();
const selectedBlock = computed(() => FULL_BLOCKS.find(block => block.id === props.selected) ?? FULL_BLOCKS[0]);
const groups = computed(() => optionGroups('full', selectedBlock.value, query.value.trim().toLocaleLowerCase()));
watch(() => props.limit, value => { limitDraft.value = String(value); });
watch(() => props.editing, () => closePanels());
function closePanels(): void { brushPanel.value?.flush(); close(); }
function toggle(value: typeof panel.value, event: Event): void { brushPanel.value?.flush(); togglePanel(value, event); }
function commitLimit(): void {
  const value = Number(limitDraft.value); if (Number.isSafeInteger(value) && value > 0) { if (value !== props.limit) emit('limit', value); }
  else limitDraft.value = String(props.limit);
}
function select(id: string): void { emit('choose', id); closePanels(); }
function key(event: KeyboardEvent): void { if (event.code === 'Escape') closePanels(); }
onMounted(() => {
  contentObserver = new ResizeObserver(() => { contentHeight.value = Math.ceil(content.value?.getBoundingClientRect().height ?? 0); });
  if (content.value) contentObserver.observe(content.value);
  document.addEventListener('keydown', key);
});
onBeforeUnmount(() => { contentObserver?.disconnect(); document.removeEventListener('keydown', key); });
defineExpose({ closePanels });
</script>

<template>
  <nav id="toolbar" class="lattice-frame editor-toolbar" :class="{ expanded }" aria-label="建筑编辑工具栏">
    <div id="toolbar-row">
      <span class="editor-mode" data-font="dynamic">{{ editing ? '建筑编辑' : '建筑预览' }}</span>
      <template v-if="editing">
        <ToolButton id="brush-toggle" class="tool tool-labelled" :expanded="expanded && panel === 'brush'" aria-label="选择笔刷与设置" aria-controls="brush-panel" :disabled="busy" @click="toggle('brush', $event)"><template #icon><ToolIcon name="brush" /></template><span data-font="dynamic">笔刷 · {{ BRUSH_LABELS[brush.kind] }}</span></ToolButton>
        <ToolButton id="editor-block-toggle" class="tool tool-labelled editor-selection" :expanded="expanded && panel === 'blocks'" aria-label="选择放置方块"
          :title="`${selectedBlock.label}\nminecraft:${selectedBlock.id}`" aria-controls="editor-block-panel" :disabled="busy" @click="toggle('blocks', $event)">
          <template #icon><ToolIcon name="cube" /></template><span class="material-thumb" :style="thumbnailStyle(selectedBlock)"></span><span data-font="dynamic">{{ selectedBlock.label }}</span>
        </ToolButton>
        <ToolButton id="editor-undo" class="tool" aria-label="撤销" title="撤销 · Ctrl/Cmd+Z" :disabled="busy || !canUndo" @click="brushPanel?.flush(); emit('undo')"><ToolIcon name="undo" /></ToolButton>
        <ToolButton id="editor-redo" class="tool" aria-label="重做" title="重做 · Ctrl+Y / Ctrl/Cmd+Shift+Z" :disabled="busy || !canRedo" @click="brushPanel?.flush(); emit('redo')"><ToolIcon name="redo" /></ToolButton>
        <label class="editor-limit" data-font="dynamic"><span>记录步数</span><input id="editor-history-limit" v-model="limitDraft" type="number" min="1" step="1"
          aria-label="撤销记录保留步数" :disabled="busy" @change="commitLimit" @blur="commitLimit" /></label>
      </template>
      <ToolButton v-else id="editor-resume" class="tool tool-labelled" :disabled="busy" @click="emit('resume')"><ToolIcon name="cube" /><span data-font="dynamic">继续编辑</span></ToolButton>
      <ToolButton id="fit" class="tool" aria-label="适应视图" title="适应视图" :disabled="busy" @click="emit('fit')"><ToolIcon name="fit" /></ToolButton>
      <ToolButton id="download" class="tool tool-labelled download" aria-label="下载 Schem" :disabled="!canDownload" @click="brushPanel?.flush(); emit('download')"><ToolIcon name="download" /><span>下载 .schem</span></ToolButton>
      <ToolButton id="history-toggle" class="tool" aria-label="本地历史" :expanded="expanded && panel === 'history'" aria-controls="history-panel" :disabled="busy" @click="toggle('history', $event)">
        <template #icon><ToolIcon name="clock" /></template>
      </ToolButton>
      <span class="editor-save" data-font="dynamic" role="status">{{ count.toLocaleString() }} 格 · {{ saveStatus }}</span>
    </div>
    <div id="toolbar-expansion" ref="expansion" :style="{ height: `${expanded ? contentHeight : 0}px` }" :aria-hidden="!expanded" :inert="!expanded" @transitionend="settled"><div ref="content" class="expansion-inner">
      <section v-if="shown === 'blocks'" id="editor-block-panel" class="panel" data-font="dynamic">
        <input id="editor-block-search" v-model="query" class="block-search" aria-label="搜索放置方块" placeholder="搜索方块名称或 ID" :disabled="busy" />
        <div class="editor-block-list">
          <div v-for="group in groups" :key="group.label" class="editor-block-group"><div class="panel-meta">{{ group.label }}</div>
            <div class="editor-block-options"><button v-for="block in group.blocks" :key="block.id" type="button" class="editor-block-option" :class="{ selected: selected === block.id }"
              :title="`minecraft:${block.id}`" :aria-pressed="selected === block.id" :disabled="busy" @click="select(block.id)">
              <span class="material-thumb" :style="thumbnailStyle(block)"></span><span>{{ block.label }}</span>
            </button></div>
          </div>
        </div>
      </section>
      <KeepAlive :max="1"><BrushPanel v-if="shown === 'brush'" ref="brushPanel" :key="world.document.id" :settings="brush" :nodes="nodes" :presets="presets" :selected-node="selectedNode" :selected="selected" :busy="panelBusy"
        @configure="value => emit('configure', value)" @preset="value => emit('preset', value)" @node="value => emit('node', value)"
        @select-node="id => emit('selectNode', id)" @repick="id => { closePanels(); emit('repick', id); }" @remove-node="id => emit('removeNode', id)" @focus-node="id => { closePanels(); emit('focusNode', id); }" /></KeepAlive>
      <HistoryPanel :active="shown === 'history'" :entries="history" :current-id="currentId" :busy="busy" :warning="warning" @restore="id => emit('restore', id)" @remove="id => emit('remove', id)" />
    </div></div>
    <LatticeCorners kind="frame" />
  </nav>
</template>
