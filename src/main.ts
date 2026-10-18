import './style.css';
import { loadGlb, disposeModel } from './glb.ts';
import { gridSize } from './geometry.ts';
import { FAMILIES, FULL_BLOCKS, SLABS, STAIRS, optionFor, suggestFamily } from './palette.ts';
import { Viewer } from './viewer.ts';
import { SHAPE_MASKS } from './block-shapes.ts';
import { colorSlots, familyColors, shapeSlot } from './colors.ts';
import type { BlockFamily, BlockOption, ModelData, VoxelResult, WorkerReply, WorkerRequest } from './types.ts';

const icon = (paths: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const uploadIcon = icon('<path d="M12 17V5m-4 4 4-4 4 4M5 16v4h14v-4"/>');
const paletteIcon = icon('<circle cx="8" cy="8" r="1"/><circle cx="15" cy="7" r="1"/><circle cx="6" cy="13" r="1"/><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7c-1.5-1-.7-3.3 1.1-3.3H18a3 3 0 0 0 3-3c0-4.4-4-8-9-8Z"/>');
document.querySelector('#app')!.innerHTML = `
<main id="workspace" data-state="empty">
  <div id="viewport"></div>
  <div id="upload-frame">
    <svg class="frame-lines" viewBox="0 0 1000 750" preserveAspectRatio="none" aria-hidden="true"><rect class="frame-base" x="8" y="8" width="984" height="734" rx="80" pathLength="1000"/><rect class="frame-runner" x="8" y="8" width="984" height="734" rx="80" pathLength="1000"/></svg>
    <button id="upload-hit" aria-label="上传 GLB" title="拖入 GLB，或点击上传">
      <span class="upload-mark">${uploadIcon}</span>
      <span class="upload-title">拖拽 GLB 到这里</span>
      <span class="upload-hint">或点击导入，转为 Minecraft 投影文件</span>
      <span class="upload-format">GLB <span aria-hidden="true">→</span> .SCHEM</span>
    </button>
  </div>
  <input id="model-file" type="file" accept=".glb" hidden />
  <nav id="toolbar" aria-label="模型工具栏" hidden>
    <div id="toolbar-row">
    <button id="file-button" class="tool" aria-label="更换 GLB" title="更换 GLB">${uploadIcon}</button>
    <span class="divider"></span>
    <input id="horizontal-size" type="number" min="1" max="65535" step="1" value="256" aria-label="最长水平边" title="最长水平边（格）" />
    <button id="convert" class="tool" aria-label="重新转换" title="重新转换">${icon('<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M18 18a8 8 0 0 1-13-3"/>')}</button>
    <span class="divider"></span>
    <button id="original-tab" class="mode" title="原始模型">原模</button><button id="result-tab" class="mode active" title="完整方块、半砖与楼梯">方块</button>
    <span class="divider"></span>
    <button id="material-toggle" class="tool" aria-label="材质映射" title="材质映射" aria-pressed="false">${paletteIcon}</button>
    <button id="slice-toggle" class="tool" aria-label="水平切片" title="水平切片" aria-pressed="false">${icon('<path d="m3 12 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M12 2v5"/>')}</button>
    <button id="fit" class="tool" aria-label="适应视图" title="适应视图">${icon('<path d="M4 9V4h5m6 0h5v5m0 6v5h-5M9 20H4v-5"/>')}</button>
    <span class="divider"></span>
    <button id="download" class="tool download" aria-label="下载 Schem" title="下载 .schem">${icon('<path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/>')}</button>
    <button id="cancel" class="tool" aria-label="取消转换" title="取消转换" hidden>${icon('<path d="m6 6 12 12M6 18 18 6"/>')}</button>
    </div>
    <div id="toolbar-expansion" aria-hidden="true" inert><div class="expansion-inner">
      <section id="material-panel" class="panel" hidden>
        <input id="block-search" type="search" placeholder="搜索方块名称或 ID" aria-label="搜索方块" autocomplete="off" />
        <div class="shape-headings" aria-hidden="true"><span>方块</span><span>半砖</span><span>楼梯</span></div>
        <div id="material-list"></div>
      </section>
      <section id="slice-panel" class="panel" hidden><div class="slice-heading"><span id="slice-height">Y 0.00–0.50</span></div><canvas id="slice-canvas" aria-label="半格高度切片"></canvas><input id="slice-range" type="range" min="0" max="1" step="1" value="0" aria-label="切片高度" /><div id="slice-info"></div></section>
    </div></div>
  </nav>
  <div id="status" role="status" aria-live="polite"></div>
</main>`;

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fileInput = el<HTMLInputElement>('model-file'), sizeInput = el<HTMLInputElement>('horizontal-size');
const sliceRange = el<HTMLInputElement>('slice-range'), sliceCanvas = el<HTMLCanvasElement>('slice-canvas');
let viewer: Viewer | undefined;
try { viewer = new Viewer(el('viewport')); } catch { /* Slices and export remain available without WebGL. */ }
let model: ModelData | undefined, result: VoxelResult | undefined, originalScene: import('three').Object3D | undefined;
let families: BlockFamily[] = [], filename = 'model.glb', busy = false, validSize = true;
let manualVariants: { slab: boolean; stairs: boolean }[] = [];
let worker: Worker | undefined, cancelJob: (() => void) | undefined;
let previewMode: 'original' | 'result' = 'result';
let activePanel: 'material' | 'slice' | undefined;

function status(message: string, error = false): void {
  el('status').textContent = message;
  el('status').classList.toggle('error', error);
}
function controls(): void {
  el('toolbar').hidden = !model;
  for (const id of ['file-button', 'convert', 'material-toggle', 'fit']) el<HTMLButtonElement>(id).disabled = busy || !model;
  for (const id of ['download', 'result-tab', 'slice-toggle']) el<HTMLButtonElement>(id).disabled = busy || !result || !validSize;
  el<HTMLButtonElement>('original-tab').disabled = busy || !model;
  el<HTMLButtonElement>('upload-hit').disabled = busy;
  sizeInput.disabled = busy; fileInput.disabled = busy;
  el('material-list').querySelectorAll('select').forEach(select => select.disabled = busy);
  el<HTMLInputElement>('block-search').disabled = busy;
}
function setBusy(value: boolean): void {
  busy = value;
  el('workspace').dataset.state = value ? 'loading' : result ? 'ready' : 'empty';
  el('upload-frame').setAttribute('aria-busy', String(value));
  el('cancel').hidden = true;
  controls();
}
function setMode(mode: 'original' | 'result'): void {
  previewMode = mode; viewer?.setMode(mode);
  el('original-tab').classList.toggle('active', mode === 'original'); el('result-tab').classList.toggle('active', mode === 'result');
}
function closePanels(): void {
  activePanel = undefined; el('toolbar').classList.remove('expanded');
  el('toolbar-expansion').inert = true; el('toolbar-expansion').setAttribute('aria-hidden', 'true');
  for (const name of ['material', 'slice']) el(`${name}-toggle`).setAttribute('aria-pressed', 'false');
}
function togglePanel(name: 'material' | 'slice'): void {
  if (activePanel === name) { closePanels(); return; }
  activePanel = name;
  for (const other of ['material', 'slice']) { el(`${other}-panel`).hidden = other !== name; el(`${other}-toggle`).setAttribute('aria-pressed', String(other === name)); }
  el('toolbar').classList.add('expanded'); el('toolbar-expansion').inert = false; el('toolbar-expansion').setAttribute('aria-hidden', 'false');
  if (name === 'slice') drawSlice();
}
function fail(error: unknown): void {
  if (error instanceof DOMException && error.name === 'AbortError') { status('已取消'); return; }
  status(error instanceof Error ? error.message : '转换失败，请重新选择模型。', true);
}

function runWorker(job: WorkerRequest): Promise<WorkerReply> {
  return new Promise((resolve, reject) => {
    const current = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }); worker = current;
    const finish = () => { current.terminate(); worker = undefined; cancelJob = undefined; };
    cancelJob = () => { finish(); reject(new DOMException('已取消', 'AbortError')); }; el('cancel').hidden = false;
    current.onmessage = (event: MessageEvent<WorkerReply>) => {
      const message = event.data;
      if (message.type === 'progress') { status(message.message); return; }
      finish(); if (message.type === 'error') reject(new Error(message.message)); else resolve(message);
    };
    current.onerror = event => { finish(); reject(new Error(event.message || '处理失败，请减小尺寸后重试。')); };
    try { current.postMessage(job); } catch (error) { finish(); reject(error); }
  });
}

async function executeConversion(): Promise<void> {
  if (!model) return;
  const size = gridSize(model, Number(sizeInput.value)); validSize = true; sizeInput.setAttribute('aria-invalid', 'false');
  viewer?.resizeModel(model, size);
  const message = await runWorker({ type: 'convert', model, horizontalSize: Number(sizeInput.value), colors: families.map(familyColors),
    animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches });
  if (message.type !== 'done') return;
  result = message.output.result; viewer?.setResult(message.output.surface, message.output.falling); setMode('result');
  sliceRange.max = String(result.size.height * 2 - 1); sliceRange.value = '0'; drawSlice();
  const { full, bottom, top, stairs } = result.stats, count = full + bottom + top + stairs;
  el('download').title = `下载 .schem · ${size.width}×${size.length}×${size.height} · ${count.toLocaleString()} 格\n完整方块 ${full.toLocaleString()} · 下半砖 ${bottom.toLocaleString()} · 上半砖 ${top.toLocaleString()} · 楼梯 ${stairs.toLocaleString()}`;
  status(message.output.surface.warning ?? (viewer ? '转换完成' : '三维预览不可用，可使用切片或下载到 Axiom 查看。'), Boolean(message.output.surface.warning) || !viewer);
}

async function convertCurrent(): Promise<void> {
  if (!model || busy) return;
  closePanels(); setBusy(true); status('');
  try { await executeConversion(); }
  catch (error) { validSize = (() => { try { gridSize(model!, Number(sizeInput.value)); return true; } catch { return false; } })(); sizeInput.setAttribute('aria-invalid', String(!validSize)); fail(error); }
  finally { setBusy(false); }
}

async function openFile(file: File): Promise<void> {
  if (busy) return;
  closePanels(); setBusy(true); status('');
  let loadedScene: import('three').Object3D | undefined;
  try {
    const loaded = await loadGlb(await file.arrayBuffer()); loadedScene = loaded.scene;
    const size = gridSize(loaded.model, Number(sizeInput.value));
    if (!viewer && originalScene) disposeModel(originalScene);
    model = loaded.model; originalScene = loaded.scene; filename = file.name;
    families = model.materials.map(material => FAMILIES[suggestFamily(material)]);
    manualVariants = model.materials.map(() => ({ slab: false, stairs: false })); el<HTMLInputElement>('block-search').value = '';
    result = undefined; viewer?.setOriginal(loaded.scene, model, size); loadedScene = undefined;
    el('file-button').title = filename; renderMaterials(); controls();
    await executeConversion();
  } catch (error) { if (loadedScene) disposeModel(loadedScene); fail(error); }
  finally { fileInput.value = ''; setBusy(false); }
}

function renderMaterials(): void {
  const list = el('material-list'); list.replaceChildren();
  const query = el<HTMLInputElement>('block-search').value.trim().toLocaleLowerCase();
  const kinds = ['full', 'slab', 'stairs'] as const, names = { full: '完整方块', slab: '半砖', stairs: '楼梯' };
  const options = { full: FULL_BLOCKS, slab: SLABS, stairs: STAIRS };
  model?.materials.forEach((material, index) => {
    const row = document.createElement('div'); row.className = 'material-row';
    const source = document.createElement('div'); source.className = 'material-source';
    const dot = document.createElement('span'); dot.className = 'swatch'; dot.style.backgroundColor = `rgb(${material.color.join(',')})`;
    const label = document.createElement('label'); label.htmlFor = `material-${index}-full`; label.textContent = material.name; label.title = material.name;
    source.append(dot, label);
    const fields = document.createElement('div'); fields.className = 'material-fields';
    kinds.forEach(kind => {
      const select = document.createElement('select'); select.id = `material-${index}-${kind}`;
      select.setAttribute('aria-label', `${material.name}：${names[kind]}`); select.disabled = busy;
      const selected = optionFor(families[index], kind), groups = new Map<string, HTMLOptGroupElement>();
      options[kind].filter(block => block.id === selected.id || `${block.label} ${block.id}`.toLocaleLowerCase().includes(query)).forEach(block => {
        let group = groups.get(block.group);
        if (!group) { group = document.createElement('optgroup'); group.label = block.group; groups.set(block.group, group); select.append(group); }
        const option = new Option(block.label, block.id); option.selected = block.id === selected.id; group.append(option);
      });
      const full = FULL_BLOCKS.find(block => block.id === families[index].id)!;
      const fallback = kind !== 'full' && !manualVariants[index][kind] && !full[kind];
      select.title = `${selected.label}${fallback ? ' · 自动近色搭配，可单独修改' : ''}\nminecraft:${selected.id}`;
      select.onchange = () => { const choice = options[kind].find(block => block.id === select.value)!; void changeMaterial(index, kind, choice); };
      fields.append(select);
    });
    row.append(source, fields); list.append(row);
  });
}

async function changeMaterial(index: number, kind: 'full' | 'slab' | 'stairs', choice: BlockOption): Promise<void> {
  if (busy) return;
  const previous = families[index], previousManual = { ...manualVariants[index] };
  if (kind === 'full') {
    families[index] = { ...FAMILIES.find(family => family.id === choice.id)! };
    if (previousManual.slab) Object.assign(families[index], { slab: previous.slab, slabColor: previous.slabColor });
    if (previousManual.stairs) Object.assign(families[index], { stairs: previous.stairs, stairsColor: previous.stairsColor });
  } else {
    families[index] = { ...previous, [kind]: `minecraft:${choice.id}`, [kind === 'slab' ? 'slabColor' : 'stairsColor']: choice.color };
    manualVariants[index][kind] = true;
  }
  const scroll = el('material-list').scrollTop; renderMaterials(); el('material-list').scrollTop = scroll;
  if (!result) return;
  setBusy(true); status('');
  try {
    const message = await runWorker({ type: 'remesh', result, colors: families.map(familyColors) });
    if (message.type === 'surface') { viewer?.setResult(message.surface); setMode(previewMode); drawSlice(); status(message.surface.warning ?? '材质已更新', Boolean(message.surface.warning)); }
  } catch (error) {
    families[index] = previous; manualVariants[index] = previousManual; renderMaterials(); el('material-list').scrollTop = scroll; fail(error);
  } finally { setBusy(false); }
}

async function downloadSchem(): Promise<void> {
  if (!result || busy) return;
  setBusy(true); status('');
  try {
    const message = await runWorker({ type: 'export', result, families });
    if (message.type !== 'exported') return;
    const url = URL.createObjectURL(new Blob([message.bytes as BlobPart], { type: 'application/octet-stream' }));
    const link = document.createElement('a'); link.href = url; link.download = (filename.replace(/\.glb$/i, '').replace(/[<>:"/\\|?*]/g, '_') || 'model') + '.schem';
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); status('文件已生成');
  } catch (error) { fail(error); }
  finally { setBusy(false); }
}

el('upload-hit').onclick = el('file-button').onclick = () => fileInput.click();
fileInput.onchange = () => { const file = fileInput.files?.[0]; if (file) void openFile(file); };
sizeInput.onchange = () => void convertCurrent();
el('convert').onclick = () => void convertCurrent(); el('download').onclick = () => void downloadSchem();
el('cancel').onclick = () => cancelJob?.(); el('original-tab').onclick = () => setMode('original'); el('result-tab').onclick = () => setMode('result');
el('fit').onclick = () => viewer?.fit(); el('material-toggle').onclick = () => togglePanel('material'); el('slice-toggle').onclick = () => togglePanel('slice');
document.addEventListener('dragover', event => { event.preventDefault(); if (!busy) el('upload-frame').classList.add('dragover'); });
document.addEventListener('dragleave', event => { if (!event.relatedTarget) el('upload-frame').classList.remove('dragover'); });
document.addEventListener('drop', event => { event.preventDefault(); el('upload-frame').classList.remove('dragover'); const file = event.dataTransfer?.files[0]; if (file) void openFile(file); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closePanels(); });
sliceRange.oninput = drawSlice;
el<HTMLInputElement>('block-search').oninput = renderMaterials;

function drawSlice(): void {
  if (!result) return;
  const { width, length } = result.size, half = Number(sliceRange.value), y = half >> 1;
  const colors = families.map(family => colorSlots(familyColors(family)));
  sliceCanvas.width = width * 2; sliceCanvas.height = length * 2;
  const context = sliceCanvas.getContext('2d')!, pixels = context.createImageData(width * 2, length * 2);
  for (let z = 0; z < length * 2; z++) for (let x = 0; x < width * 2; x++) {
    const cell = (x >> 1) + (z >> 1) * width + y * width * length;
    const occupied = SHAPE_MASKS[result.shapes[cell]] & (1 << ((x & 1) + (z & 1) * 2 + (half & 1) * 4));
    const color = occupied ? colors[result.materials[cell]][shapeSlot(result.shapes[cell])] : (((x >> 1) + (z >> 1)) % 2 ? [20, 28, 35] : [23, 32, 39]);
    pixels.data.set([...color, 255], (x + z * width * 2) * 4);
  }
  context.putImageData(pixels, 0, 0); sliceCanvas.style.aspectRatio = `${width}/${length}`;
  el('slice-height').textContent = `Y ${(half / 2).toFixed(2)}–${((half + 1) / 2).toFixed(2)}`;
}
sliceCanvas.onmousemove = event => {
  if (!result) return;
  const rect = sliceCanvas.getBoundingClientRect(), { width, length } = result.size;
  const sx = Math.max(0, Math.min(width * 2 - 1, Math.floor((event.clientX - rect.left) / rect.width * width * 2)));
  const sz = Math.max(0, Math.min(length * 2 - 1, Math.floor((event.clientY - rect.top) / rect.height * length * 2)));
  const x = sx >> 1, z = sz >> 1, half = Number(sliceRange.value), cell = x + z * width + (half >> 1) * width * length;
  const occupied = SHAPE_MASKS[result.shapes[cell]] & (1 << ((sx & 1) + (sz & 1) * 2 + (half & 1) * 4));
  const shape = result.shapes[cell], kind = shape === 1 || shape === 2 ? 'slab' : shape >= 4 ? 'stairs' : 'full';
  el('slice-info').textContent = `X ${x} · Z ${z} / ${occupied ? optionFor(families[result.materials[cell]], kind).label : '空气'}`;
};
window.addEventListener('beforeunload', () => { worker?.terminate(); viewer?.dispose(); });
