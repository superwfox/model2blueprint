import { BufferGeometry, Color, LoadingManager, Matrix4, Mesh, Object3D, Texture, Vector3, InstancedMesh, SkinnedMesh, MeshStandardMaterial } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ModelData, MeshPart, SourceMaterial, Vec3 } from '../core/types.ts';

export function inspectGlb(buffer: ArrayBuffer): void {
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2)
    throw new Error('请选择 Blender 导出的 GLB 2.0 文件。');
  if (view.getUint32(8, true) !== buffer.byteLength || view.getUint32(16, true) !== 0x4e4f534a)
    throw new Error('GLB 文件不完整，或 JSON 数据块无效。');
  const length = view.getUint32(12, true);
  if (length > buffer.byteLength - 20) throw new Error('GLB 数据块长度无效。');
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
  const unsupported = (json.extensionsUsed ?? []).filter((name: string) =>
    ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'].includes(name));
  if (unsupported.length) throw new Error(`此文件使用 ${unsupported.join(' / ')}。请从 Blender 重新导出不压缩几何、使用 PNG/JPEG 贴图的 GLB。`);
  if (json.animations?.length || json.skins?.length) throw new Error('请先在 Blender 中将动画或骨骼应用为静态网格，再导出 GLB。');
  for (const entry of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (entry.uri && !entry.uri.startsWith('data:')) throw new Error('文件引用了外部资源。请导出将资源嵌入文件的 GLB。');
  }
  for (const mesh of json.meshes ?? []) {
    for (const p of mesh.primitives) {
      if (p.mode !== undefined && p.mode !== 4) throw new Error(`“${mesh.name ?? '网格'}”不是三角面网格，请在 Blender 中转换后重新导出。`);
    }
  }
}

async function parseGlb(buffer: ArrayBuffer) {
  inspectGlb(buffer);
  const manager = new LoadingManager();
  manager.setURLModifier(url => {
    if (!url.startsWith('blob:') && !url.startsWith('data:')) throw new Error('GLB 包含外部资源，已停止读取。');
    return url;
  });
  return new GLTFLoader(manager).parseAsync(buffer, '');
}

export async function loadGlbScene(buffer: ArrayBuffer): Promise<Object3D> {
  return (await parseGlb(buffer)).scene;
}

export async function loadGlb(buffer: ArrayBuffer): Promise<{ scene: Object3D; model: ModelData }> {
  const gltf = await parseGlb(buffer);
  try {
    const references = gltf.parser.associations as Map<Object3D, { nodes?: number }>;
    const model = extractModel(gltf.scene, object => {
      let cursor: Object3D | null = object;
      while (cursor) {
        if (references.get(cursor)?.nodes !== undefined) return cursor;
        cursor = cursor.parent;
      }
      return object;
    });
    return { scene: gltf.scene, model };
  } catch (error) {
    disposeModel(gltf.scene);
    throw error;
  }
}

export function extractModel(scene: Object3D, groupFor: (o: Object3D) => Object3D = o => o): ModelData {
  scene.updateMatrixWorld(true);
  const materials: SourceMaterial[] = [];
  const materialIds = new Map<string, number>();
  const groups = new Map<string, { name: string; positions: number[]; indices: number[]; materials: number[] }>();
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const position = new Vector3(), transform = new Matrix4(), instanceMatrix = new Matrix4();
  let triangleCount = 0;
  scene.traverseVisible(object => {
    if (!(object instanceof Mesh)) return;
    if (object instanceof SkinnedMesh) throw new Error(`“${object.name}”使用了骨骼，请先应用为静态网格。`);
    const geometry = object.geometry as BufferGeometry, attribute = geometry.getAttribute('position');
    if (!attribute) return;
    const index = geometry.index;
    const count = index?.count ?? attribute.count;
    if (count % 3) throw new Error(`“${object.name}”的三角面索引不完整。`);
    const definitions = Array.isArray(object.material) ? object.material : [object.material];
    const ids = definitions.map(material => {
      if (material.transparent || material.alphaTest > 0)
        throw new Error(`“${material.name || object.name}”使用透明裁剪。请将孔洞做成实际几何后导出。`);
      let id = materialIds.get(material.uuid);
      if (id === undefined) {
        id = materials.length;
        if (id >= 65535) throw new Error('模型材质过多，请先在 Blender 中合并重复材质。');
        materialIds.set(material.uuid, id);
        const c = ((material as MeshStandardMaterial).color ?? new Color(0.5, 0.5, 0.5)).clone().convertLinearToSRGB();
        materials.push({ name: material.name || `材质 ${id + 1}`, color: [c.r * 255, c.g * 255, c.b * 255] });
      }
      return id;
    });
    const instances = object instanceof InstancedMesh ? object.count : 1;
    for (let instance = 0; instance < instances; instance++) {
      transform.copy(object.matrixWorld);
      if (object instanceof InstancedMesh) { object.getMatrixAt(instance, instanceMatrix); transform.multiply(instanceMatrix); }
      const root = groupFor(object), key = `${root.uuid}:${instance}`;
      let group = groups.get(key);
      if (!group) { group = { name: root.name || object.name || '未命名部件', positions: [], indices: [], materials: [] }; groups.set(key, group); }
      const offset = group.positions.length / 3;
      for (let v = 0; v < attribute.count; v++) {
        object.getVertexPosition(v, position).applyMatrix4(transform);
        if (![position.x, position.y, position.z].every(Number.isFinite)) throw new Error(`“${group.name}”包含无效坐标。`);
        group.positions.push(position.x, position.y, position.z);
        for (let axis = 0; axis < 3; axis++) { const value = position.getComponent(axis); min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value); }
      }
      for (let t = 0; t < count; t += 3) {
        for (let k = 0; k < 3; k++) group.indices.push(offset + (index ? index.getX(t + k) : t + k));
        const region = geometry.groups.find(g => t >= g.start && t < g.start + g.count);
        group.materials.push(ids[region?.materialIndex ?? 0] ?? ids[0]);
      }
      triangleCount += count / 3;
    }
  });
  if (!triangleCount) throw new Error('GLB 的默认场景中没有可转换的网格。');
  const parts: MeshPart[] = Array.from(groups.values(), g => ({ name: g.name,
    positions: new Float64Array(g.positions), indices: new Uint32Array(g.indices), materials: new Uint16Array(g.materials) }));
  return { parts, materials, min, max, triangleCount };
}

export function disposeModel(scene: Object3D): void {
  const textures = new Set<import('three').Texture>();
  scene.traverse(object => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const value of Object.values(material)) {
        if (value instanceof Texture) textures.add(value);
      }
      material.dispose();
    }
  });
  for (const texture of textures) { texture.dispose(); texture.source?.data?.close?.(); }
}
