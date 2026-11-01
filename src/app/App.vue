<script setup lang="ts">
import { nextTick, onMounted, onBeforeUnmount, ref } from 'vue';
import Viewport from './components/Viewport.vue';
import UploadArea from './components/UploadArea.vue';
import WorkspaceToolbar from './components/WorkspaceToolbar.vue';
import TransientBar from './components/TransientBar.vue';
import NavigationBar from './components/NavigationBar.vue';
import EditorToolbar from './components/EditorToolbar.vue';
import { useWorkspace } from './useWorkspace.ts';

const viewport = ref<InstanceType<typeof Viewport>>(), upload = ref<InstanceType<typeof UploadArea>>();
const toolbar = ref<InstanceType<typeof WorkspaceToolbar>>(), fileInput = ref<HTMLInputElement>();
const editorToolbar = ref<InstanceType<typeof EditorToolbar>>();
const navigationBar = ref<InstanceType<typeof TransientBar>>(), navigationVisible = ref(false), navigationHeight = ref(0);
const workspace = useWorkspace(async () => {
  await nextTick(); await Promise.all([viewport.value?.settle(), upload.value?.settle()]);
});
const { model, result, families, manualVariants, filename, horizontalSize, previewMode, busy, canCancel,
  validSize, phase, progress, message, error, downloadTitle, historyEntries, currentHistoryId, cacheWarning, navigationState, navigationPulse,
  hasWorld, hasPreview, canDownload, building } = workspace;
const { world: buildingWorld, editing, revision: buildingRevision, selected: selectedBlock, limit: historyLimit,
  canUndo, canRedo, count: buildingCount, saveStatus } = building;
function choose(): void { if (!busy.value) fileInput.value?.click(); }
function openFile(file: File): void { toolbar.value?.closePanels(); void workspace.openFile(file); }
function fileChanged(event: Event): void {
  const input = event.target as HTMLInputElement, file = input.files?.[0];
  input.value = ''; if (file) openFile(file);
}
function convert(): void { toolbar.value?.closePanels(); void workspace.convertCurrent(); }
function startBlank(): void { toolbar.value?.closePanels(); editorToolbar.value?.closePanels(); void workspace.startBlank(); }
onMounted(() => {
  window.addEventListener('pagehide', workspace.flushView); window.addEventListener('beforeunload', workspace.dispose);
  void workspace.initialize();
});
onBeforeUnmount(() => {
  window.removeEventListener('pagehide', workspace.flushView); window.removeEventListener('beforeunload', workspace.dispose); workspace.dispose();
});
</script>

<template>
  <main id="workspace" :data-state="phase" :class="{ 'has-preview': hasPreview, 'navigation-open': navigationVisible, 'selecting-landing': navigationState.selecting, 'is-editing': editing }"
    :style="{ '--navigation-status-bottom': `${navigationHeight + 82}px` }">
    <Viewport ref="viewport" :navigation-enabled="hasWorld && !busy && !building.working.value" @ready="workspace.setViewer" />
    <header class="workspace-header">
      <div class="brand"><span class="brand-wordmark">GLB <span class="brand-arrow">→</span> SCHEM</span><span class="brand-caption">建筑转换器</span></div>
      <span class="local-badge"><span aria-hidden="true"></span>本地处理 · 模型无需上传</span>
    </header>
    <UploadArea ref="upload" :busy="busy" :working="phase === 'loading'" :has-result="hasPreview" :progress="progress" @choose="choose" @file="openFile" @blank="startBlank" />
    <input id="model-file" ref="fileInput" type="file" accept=".glb" :disabled="busy" hidden @change="fileChanged" />
    <EditorToolbar v-if="buildingWorld && (editing || building.forked.value)" ref="editorToolbar" :world="buildingWorld" :revision="buildingRevision" :editing="editing" :selected="selectedBlock" :limit="historyLimit"
      :can-undo="canUndo" :can-redo="canRedo" :count="buildingCount" :save-status="building.working.value ? '计算中' : saveStatus" :busy="busy" :panel-busy="busy" :can-download="canDownload"
      :brush="building.brush.value" :nodes="building.nodes.value" :presets="building.presets.value" :selected-node="building.selectedNode.value"
      :history="historyEntries" :current-id="currentHistoryId" :warning="cacheWarning"
      @choose="building.choose" @limit="building.setLimit" @undo="building.undo" @redo="building.redo" @exit="workspace.exitEdit" @resume="workspace.resumeEdit"
      @configure="building.configure" @preset="building.savePreset" @node="building.saveNode" @select-node="building.selectNode" @repick="building.repickNode" @remove-node="building.removeNode" @focus-node="building.focusNode"
      @fit="workspace.fit" @download="workspace.downloadSchem" @restore="workspace.restoreHistory" @remove="workspace.deleteHistory" />
    <WorkspaceToolbar v-else ref="toolbar" :model="model" :result="result" :families="families" :manual="manualVariants" :filename="filename"
      v-model:size="horizontalSize" :mode="previewMode" :busy="busy" :valid-size="validSize" :can-cancel="canCancel" :download-title="downloadTitle"
      :history="historyEntries" :current-history-id="currentHistoryId" :cache-warning="cacheWarning"
      @choose="choose" @convert="convert" @mode="workspace.setMode" @material="workspace.changeMaterial" @fit="workspace.fit" @download="workspace.downloadSchem" @cancel="workspace.cancel"
      @restore="workspace.restoreHistory" @remove="workspace.deleteHistory" />
    <TransientBar ref="navigationBar" :refresh-key="navigationPulse" :enabled="hasWorld && !busy" label="视角快捷操作" @visibility="navigationVisible = $event" @height="navigationHeight = $event">
      <NavigationBar :state="navigationState" :can-enter="hasPreview" @speed="workspace.setNavigationSpeed" @first-person="workspace.toggleFirstPerson"
        @refresh="navigationBar?.show()" />
    </TransientBar>
    <footer class="workspace-footer"><span class="empty-note">完整方块 · 半砖 · 楼梯 · 展示架</span><span class="view-note" data-font="dynamic">点击视口：WASD 移动 · ↑↓ 升降 · {{ editing ? 'Space＋拖动旋转' : '拖动旋转' }} · 滚轮缩放 · Shift 精细缩放</span><span>Minecraft Java 26.3</span></footer>
    <div id="status" :class="{ error: error || cacheWarning }" role="status" aria-live="polite">{{ cacheWarning || message }}</div>
  </main>
</template>
