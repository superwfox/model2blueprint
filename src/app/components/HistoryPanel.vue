<script setup lang="ts">
import ToolButton from './ToolButton.vue';
import type { HistoryEntry } from '../../adapters/history/types.ts';

defineProps<{ active: boolean; entries: HistoryEntry[]; currentId?: string; busy: boolean; warning: string }>();
const emit = defineEmits<{ restore: [id: string]; remove: [id: string] }>();
function date(time: number): string { return new Date(time).toLocaleString('zh-CN', { hour12: false }); }
</script>

<template>
  <section id="history-panel" class="panel" :hidden="!active" aria-label="本地历史" data-font="dynamic">
    <div class="panel-heading"><span>本地历史</span><span class="panel-meta">{{ entries.length }} 条 · 仅保存在当前浏览器</span></div>
    <p class="history-note">导入记录保留转换状态；编辑另存建筑记录及撤销历史。刷新自动恢复上次视图。</p>
    <p v-if="warning" class="history-warning" role="status">{{ warning }}</p>
    <p v-if="!entries.length" class="history-empty">暂无历史记录，导入或创建建筑后将自动保存。</p>
    <ol v-else-if="active" class="history-list">
      <li v-for="entry in entries" :key="entry.id" class="history-row" :data-current="entry.id === currentId">
        <div class="history-description">
          <div class="history-title"><span class="history-filename" :title="entry.filename">{{ entry.filename }}</span><span v-if="entry.id === currentId" class="history-current">当前视图</span></div>
          <div class="history-meta">{{ entry.kind === 'building' ? '建筑' : '导入' }} · {{ entry.dimensions.width }}×{{ entry.dimensions.length }}×{{ entry.dimensions.height }} · {{ entry.blocks.toLocaleString() }} 格 · 创建 {{ date(entry.createdAt) }}</div>
          <div class="history-meta">更新 {{ date(entry.updatedAt) }}</div>
        </div>
        <div class="history-actions">
          <ToolButton class="history-action" :disabled="busy" :aria-label="`恢复到视图：${entry.filename}`" @click="emit('restore', entry.id)">恢复到视图</ToolButton>
          <ToolButton class="history-action" :disabled="busy" :aria-label="`删除记录：${entry.filename}`" title="删除本地记录，保留当前打开的视图" @click="emit('remove', entry.id)">删除</ToolButton>
        </div>
      </li>
    </ol>
    <p class="history-note">记录只会手动删除；清理浏览器站点数据也会清除记录。空间不足时保留旧记录并提示本次未缓存。</p>
  </section>
</template>
