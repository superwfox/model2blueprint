<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import WallStructureForm from './WallStructureForm.vue';
import { useAutoDraft } from '../useAutoDraft.ts';
import { validatePreset, validateNode } from '../../core/walls.ts';
import { BRUSH_LABELS, defaultPreset, defaultStructure, STRUCTURE_LABELS, wallArea } from '../../core/brush-types.ts';
import type { BrushSettings, WallNode, WallPreset, WallStructureKind } from '../../core/brush-types.ts';
const props = defineProps<{ settings: BrushSettings; presets: WallPreset[]; nodes: WallNode[]; selectedNode: string; selected: string; busy: boolean }>();
const emit = defineEmits<{ configure: [value: BrushSettings]; preset: [value: WallPreset]; node: [value: WallNode]; selectNode: [id: string]; repick: [id: string]; removeNode: [id: string]; focusNode: [id: string] }>();
const configuration = ref<HTMLElement>();
watch(() => props.settings.kind, () => { if (configuration.value) configuration.value.scrollTop = 0; }, { flush: 'post' });
function plain<T extends object>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
const currentPreset = computed(() => props.presets.find(value => value.id === props.settings.preset));
const currentNode = computed(() => props.nodes.find(value => value.id === props.selectedNode));
const { draft: presetDraft, error: presetError, flush: flushPreset } = useAutoDraft(() => currentPreset.value, validatePreset, value => emit('preset', value));
const { draft: nodeDraft, error: nodeError, flush: flushNode } = useAutoDraft(() => currentNode.value, value => validateNode(value, props.presets), value => emit('node', value));
function flush(): void { flushPreset(); flushNode(); }
function selectPreset(id: string): void { flush(); configure({ preset: id }); }
function append(kind: WallStructureKind): void {
  if (presetDraft.value && presetDraft.value.structures.length < 64) presetDraft.value.structures.push(defaultStructure(crypto.randomUUID(), kind));
}
defineExpose({ flush });
const hasInside = computed(() => Boolean(nodeDraft.value && Math.abs(wallArea(nodeDraft.value)) > 1e-6));
function configure(patch: Partial<BrushSettings>): void { if (patch.kind && patch.kind !== props.settings.kind) flush(); emit('configure', { ...props.settings, ...patch }); }
function number(event: Event): number { return Number((event.target as HTMLInputElement).value); }
function size(axis: number, event: Event): void { const next = [...props.settings.size] as [number, number, number]; next[axis] = number(event); if (next.every(value => Number.isInteger(value) && value > 0)) configure({ size: next }); }
function create(copy: boolean): void {
  flush();
  const value = copy && currentPreset.value ? plain(presetDraft.value ?? currentPreset.value) : defaultPreset('');
  value.id = crypto.randomUUID(); value.name = copy ? `${value.name} · 副本` : `墙体预设 ${props.presets.length + 1}`; emit('preset', value);
}
function curve(index: number): void {
  if (!nodeDraft.value) return; const points = nodeDraft.value.points, a = points[(index + points.length - 1) % points.length].position, b = points[index].position;
  points[index].control = a.map((value, axis) => Math.round((value + b[axis]) / 2)) as [number, number, number];
}
</script>
<template>
  <section id="brush-panel" class="panel brush-panel" :class="{ 'wall-brush': settings.kind === 'wall' }" data-font="dynamic">
    <div class="brush-options" aria-label="选择笔刷">
      <button v-for="(label, kind) in BRUSH_LABELS" :key="kind" type="button" class="brush-option" :class="{ selected: settings.kind === kind }" :aria-pressed="settings.kind === kind" :disabled="busy" @click="configure({ kind })">
        <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path v-if="kind === 'block'" d="m20 5 13 7v16l-13 7-13-7V12l13-7Zm0 14 13-7M20 19 7 12m13 7v16" />
          <path v-else-if="kind === 'wall'" d="M4 9h32v24H4V9Zm0 8h32M4 25h32M12 9v8m16-8v8M20 17v8m-8 0v8m16-8v8" />
          <path v-else-if="kind === 'box'" d="m4 13 23-7 9 8v17l-23 6-9-8V13Zm0 0 9 7 23-6M13 20v17" />
          <template v-else-if="kind === 'sphere'"><circle cx="20" cy="20" r="15" /><ellipse cx="20" cy="20" rx="7" ry="15" /><ellipse cx="20" cy="20" rx="15" ry="6" /></template>
          <path v-else-if="kind === 'smooth'" d="M3 30c7-24 11 8 18-8s11-1 16-12M3 36h34" />
          <path v-else d="m3 8 11 3 6-7 7 11 10-4M14 11l-3 15-7 10m7-10 13 2 8 9M27 15l-3 13-7 9" />
        </svg><span>{{ label }}</span>
      </button>
    </div>
    <div ref="configuration" class="brush-configuration">
    <div v-if="settings.kind === 'block'" class="brush-hint">长按左键沿原有表面连续绘制，自动补齐途经格子；本笔新放方块不会抬高落点。整笔计一步撤销。按住 Space 拖动旋转，Esc 返回建筑预览。</div>
    <template v-if="settings.kind === 'box' || settings.kind === 'sphere'">
      <div class="brush-fields">
        <label>放置方式<select :value="settings.fixed ? 'fixed' : 'flexible'" :disabled="busy" @change="configure({ fixed: ($event.target as HTMLSelectElement).value === 'fixed' })"><option value="flexible">灵活 · 两点选择</option><option value="fixed">固定 · 输入尺寸</option></select></label>
        <label class="brush-checkbox"><input type="checkbox" :checked="settings.hollow" :disabled="busy" @change="configure({ hollow: ($event.target as HTMLInputElement).checked })" />空心</label>
        <template v-if="settings.fixed && settings.kind === 'box'"><label v-for="(label, axis) in ['长 X', '高 Y', '宽 Z']" :key="label">{{ label }}<input type="number" min="1" :value="settings.size[axis]" :disabled="busy" @change="size(axis, $event)" /></label></template>
        <label v-if="settings.fixed && settings.kind === 'sphere'">半径<input type="number" min="1" :value="settings.radius" :disabled="busy" @change="configure({ radius: Math.max(1, number($event)) })" /></label>
      </div>
      <p class="brush-hint">{{ settings.fixed ? '尺寸设置后，单击放置。' : settings.kind === 'box' ? '依次点击两个对角点放置；Esc 取消本次选点。' : '依次点击球心、半径点放置；Esc 取消本次选点。' }}已有方块保留。空心壳厚 1 格。</p>
    </template>
    <template v-if="settings.kind === 'smooth'">
      <div class="brush-fields"><label>平滑半径<input type="number" min="1" max="64" :value="settings.smoothRadius" :disabled="busy" @change="configure({ smoothRadius: Math.max(1, Math.min(64, Math.round(number($event)))) })" /></label>
        <label>强度<input type="range" min="0.05" max="1" step="0.05" :value="settings.strength" :disabled="busy" @input="configure({ strength: number($event) })" /></label><output>{{ Math.round(settings.strength * 100) }}%</output></div>
      <p class="brush-hint">单击地表削峰填谷，边缘渐弱；保留原表层材质。按住左键持续平滑，一次按下到松开计一步撤销；按住 Space 拖动旋转。该工具会改变建筑表面。</p>
    </template>
    <template v-if="settings.kind === 'fracture'">
      <div class="brush-fields">
        <label>影响半径<input type="number" min="1" max="64" :value="settings.fractureRadius" :disabled="busy" @change="configure({ fractureRadius: Math.max(1, Math.min(64, Math.round(number($event)))) })" /></label>
        <label>裂块大小<input type="number" min="2" max="512" :value="settings.fractureScale" :disabled="busy" @change="configure({ fractureScale: Math.max(2, Math.min(512, number($event))), fractureWidth: Math.min(settings.fractureWidth, Math.max(2, number($event)) / 2) })" /></label>
        <label>裂缝宽度<input type="number" min="1" :max="settings.fractureScale / 2" step="0.5" :value="settings.fractureWidth" :disabled="busy" @change="configure({ fractureWidth: Math.max(1, Math.min(settings.fractureScale / 2, number($event))) })" /></label>
        <label>深度<input type="number" min="1" max="64" :value="settings.fractureDepth" :disabled="busy" @change="configure({ fractureDepth: Math.max(1, Math.min(64, Math.round(number($event)))) })" /></label>
        <label>随机种子<input type="number" step="1" :value="settings.fractureSeed" :disabled="busy" @change="configure({ fractureSeed: Math.round(number($event)) })" /></label>
      </div>
      <p class="brush-hint">单击挖出地表龟裂，所有长度单位均为格。默认半径 8、裂块大小 8、宽 1、深 3；按世界坐标与种子连接相邻区域。以完整裂缝边缘估算深度，重复落笔不持续向下钻挖。一次操作计一步。</p>
    </template>
    <template v-if="settings.kind === 'wall'">
      <p class="wall-gesture-hint" title="靠近已有端点或中间节点可连接，墙线仍独立编辑；角度显示水平转角，首段以 +X 为基准；Alt 吸附 45° 倍数，Shift 锁定高度；Ctrl 选端点后再选贝塞尔控制点；点击起点闭合。">节点连接 · Alt 45° · Shift 平面 · Ctrl 曲线 · Esc 结束 · 修改自动应用</p>
      <div class="wall-preset-layout">
        <aside class="wall-preset-list" aria-label="墙体预设列表">
          <button v-for="preset in presets" :key="preset.id" type="button" class="brush-action" :class="{ active: preset.id === settings.preset }" :aria-pressed="preset.id === settings.preset" :disabled="busy" @click="selectPreset(preset.id)">{{ preset.name }}</button>
          <button type="button" class="brush-action" :disabled="busy" @click="create(false)">＋ 新建预设</button>
          <button type="button" class="brush-action" :disabled="busy || !currentPreset" @click="create(true)">复制为副本</button>
        </aside>
        <div v-if="presetDraft" class="wall-preset-content">
          <div class="wall-preset-bar"><label>预设<input v-model="presetDraft.name" type="text" aria-label="预设名称" :disabled="busy" /></label>
            <div class="wall-add-actions"><button v-for="(label, kind) in STRUCTURE_LABELS" :key="kind" type="button" class="brush-action" :title="`追加${label}，最多 64 项结构`" :disabled="busy || presetDraft.structures.length >= 64" @click="append(kind)">＋ {{ label }}</button></div>
          </div>
          <p v-if="presetError" class="brush-error" role="status">{{ presetError }} 当前建筑保持上次有效结构。</p>
          <div class="wall-structure-list" aria-label="墙体结构表单列表">
            <WallStructureForm v-for="(structure, index) in presetDraft.structures" :key="structure.id" v-model="presetDraft.structures[index]" :index="index" :selected="selected" :disabled="busy" @remove="presetDraft.structures.splice(index, 1)" />
            <p v-if="!presetDraft.structures.length" class="brush-hint">点击上方按钮追加结构。</p>
          </div>
        </div>
      </div>
        <div class="wall-node-editor">
          <label>墙节点<select :value="selectedNode" :disabled="busy" @change="flush(); emit('selectNode', ($event.target as HTMLSelectElement).value)"><option value="">选择已有墙体</option><option v-for="node in nodes" :key="node.id" :value="node.id">{{ node.name }} · {{ node.points.length }} 点</option></select></label>
          <template v-if="nodeDraft">
            <div class="brush-fields"><label>节点名称<input v-model="nodeDraft.name" :disabled="busy" /></label><label>引用预设<select v-model="nodeDraft.preset" :disabled="busy"><option v-for="preset in presets" :key="preset.id" :value="preset.id">{{ preset.name }}</option></select></label></div>
            <div class="brush-fields"><label class="brush-checkbox"><input v-model="nodeDraft.closed" type="checkbox" :disabled="busy || nodeDraft.points.length < 3" />闭合墙线</label>
              <template v-if="hasInside"><label class="brush-checkbox"><input v-model="nodeDraft.inside" type="checkbox" :disabled="busy" />内侧支撑</label><label class="brush-checkbox"><input v-model="nodeDraft.outside" type="checkbox" :disabled="busy" />外侧支撑</label></template></div>
            <div class="wall-point-list"><div v-for="(point, index) in nodeDraft.points" :key="index" class="wall-point-row"><span>点 {{ index + 1 }}</span>
              <label v-for="(axis, a) in ['X', 'Y', 'Z']" :key="axis">{{ axis }}<input v-model.number="point.position[a]" type="number" :min="a === 1 ? 0 : undefined" :disabled="busy" /></label>
              <button type="button" class="brush-action" :disabled="busy || nodeDraft.points.length <= 2" @click="nodeDraft.points.splice(index, 1)">移除点</button>
              <template v-if="point.control"><span>控制点</span><label v-for="(axis, a) in ['X', 'Y', 'Z']" :key="`c${axis}`">{{ axis }}<input v-model.number="point.control[a]" type="number" :min="a === 1 ? 0 : undefined" :disabled="busy" /></label><button type="button" class="brush-action" :disabled="busy" @click="point.control = undefined">改为直线</button></template>
              <button v-else-if="index > 0 || nodeDraft.closed" type="button" class="brush-action" :disabled="busy" @click="curve(index)">改为曲线</button>
            </div></div>
            <p v-if="nodeError" class="brush-error" role="status">{{ nodeError }} 当前建筑保持上次有效节点。</p><div class="brush-fields"><button type="button" class="brush-action" :disabled="busy" @click="flush(); emit('repick', selectedNode)">重新选点</button><button type="button" class="brush-action" :disabled="busy" @click="flush(); emit('focusNode', selectedNode)">定位墙体</button><button type="button" class="brush-action" :disabled="busy" @click="flush(); emit('removeNode', selectedNode)">删除墙节点</button></div>
          </template><p v-else class="brush-hint">在视口绘制墙线后，在此选择整面墙调整。节点和预设随建筑保存。</p>
        </div>
    </template>
    </div>
  </section>
</template>
