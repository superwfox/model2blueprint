<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import ToolButton from './ToolButton.vue';
import ToolIcon from './ToolIcon.vue';
import LatticeCorners from './LatticeCorners.vue';
import MaterialPanel from './MaterialPanel.vue';
import SlicePanel from './SlicePanel.vue';
import HistoryPanel from './HistoryPanel.vue';
import type { HistoryEntry } from '../../adapters/history/types.ts';
import type { BlockFamily, BlockKind, BlockOption, ManualVariants, ModelData, VoxelResult } from '../../core/types.ts';
import type { PreviewMode } from '../useWorkspace.ts';

defineProps<{ model?: ModelData; result?: VoxelResult; families: BlockFamily[]; manual: ManualVariants[];
  filename: string; size: string; mode: PreviewMode; busy: boolean; validSize: boolean; canCancel: boolean; downloadTitle: string;
  history: HistoryEntry[]; currentHistoryId?: string; cacheWarning: string }>();
const emit = defineEmits<{ choose: []; 'update:size': [value: string]; convert: []; mode: [value: PreviewMode];
  material: [index: number, kind: BlockKind, choice: BlockOption]; fit: []; download: []; cancel: [];
  restore: [id: string]; remove: [id: string] }>();
type Panel = 'material' | 'slice' | 'history';
const panel = ref<Panel>('material'), expanded = ref(false);
function closePanels(): void { expanded.value = false; }
function togglePanel(name: Panel): void {
  expanded.value = panel.value !== name || !expanded.value; panel.value = name;
}
function updateSize(event: Event): void { emit('update:size', (event.target as HTMLInputElement).value); }
function onKeyDown(event: KeyboardEvent): void { if (event.key === 'Escape') closePanels(); }
onMounted(() => document.addEventListener('keydown', onKeyDown));
onBeforeUnmount(() => document.removeEventListener('keydown', onKeyDown));
defineExpose({ closePanels });
</script>

<template>
  <nav id="toolbar" class="lattice-frame" :class="{ expanded }" aria-label="模型工具栏" :hidden="!model && !history.length">
    <div id="toolbar-row">
      <ToolButton id="file-button" class="tool" aria-label="更换 GLB" :title="filename" :disabled="busy || !model" @click="emit('choose')"><ToolIcon name="upload" /></ToolButton>
      <span class="divider"></span>
      <label class="size-control"><span>最长边</span><input id="horizontal-size" type="number" min="1" max="65535" step="1" :value="size"
        aria-label="最长水平边" title="最长水平边（格）" :aria-invalid="!validSize" :disabled="busy || !model" @input="updateSize" @change="emit('convert')" /><span>格</span></label>
      <ToolButton id="convert" class="tool" aria-label="重新转换" title="重新转换" :disabled="busy || !model" @click="emit('convert')"><ToolIcon name="convert" /></ToolButton>
      <span class="divider"></span>
      <div class="mode-switch" role="group" aria-label="预览模式">
        <ToolButton id="original-tab" class="mode" :class="{ active: mode === 'original' }" title="原始模型" :aria-pressed="mode === 'original'"
          :disabled="busy || !model" @click="emit('mode', 'original')">原模</ToolButton>
        <ToolButton id="result-tab" class="mode" :class="{ active: mode === 'result' }" title="完整方块、半砖、楼梯与展示架" :aria-pressed="mode === 'result'"
          :disabled="busy || !result || !validSize" @click="emit('mode', 'result')">方块</ToolButton>
      </div>
      <span class="divider"></span>
      <ToolButton id="material-toggle" class="tool tool-labelled" aria-label="材质映射" :title="expanded && panel === 'material' ? '收起材质映射' : '材质映射'"
        :expanded="expanded && panel === 'material'" aria-controls="material-panel" :disabled="busy || !model" @click="togglePanel('material')">
        <template #icon><ToolIcon name="palette" /></template><span>材质</span>
      </ToolButton>
      <ToolButton id="slice-toggle" class="tool tool-labelled" aria-label="水平切片" :title="expanded && panel === 'slice' ? '收起水平切片' : '水平切片'"
        :expanded="expanded && panel === 'slice'" aria-controls="slice-panel" :disabled="busy || !result || !validSize" @click="togglePanel('slice')">
        <template #icon><ToolIcon name="slice" /></template><span>切片</span>
      </ToolButton>
      <ToolButton id="fit" class="tool" aria-label="适应视图" title="适应视图" :disabled="busy || !model" @click="emit('fit')"><ToolIcon name="fit" /></ToolButton>
      <span class="divider"></span>
      <ToolButton id="download" class="tool tool-labelled download" aria-label="下载 Schem" :title="downloadTitle" :disabled="busy || !result || !validSize"
        @click="emit('download')"><ToolIcon name="download" /><span>下载 .schem</span></ToolButton>
      <ToolButton id="history-toggle" class="tool" aria-label="导入历史" :title="expanded && panel === 'history' ? '收起导入历史' : '导入历史'"
        :expanded="expanded && panel === 'history'" aria-controls="history-panel" :disabled="busy" @click="togglePanel('history')">
        <template #icon><ToolIcon name="clock" /></template>
      </ToolButton>
      <ToolButton id="cancel" class="tool" aria-label="取消转换" title="取消转换" :hidden="!canCancel" @click="emit('cancel')"><ToolIcon name="cancel" /></ToolButton>
    </div>
    <div id="toolbar-expansion" :aria-hidden="!expanded" :inert="!expanded"><div class="expansion-inner">
      <MaterialPanel :active="panel === 'material'" :busy="busy" :materials="model?.materials ?? []" :families="families" :manual="manual"
        @change="(index, kind, choice) => emit('material', index, kind, choice)" />
      <SlicePanel :active="panel === 'slice'" :result="result" :families="families" />
      <HistoryPanel :active="panel === 'history'" :entries="history" :current-id="currentHistoryId" :busy="busy" :warning="cacheWarning"
        @restore="id => emit('restore', id)" @remove="id => emit('remove', id)" />
    </div></div>
    <LatticeCorners kind="frame" />
  </nav>
</template>
