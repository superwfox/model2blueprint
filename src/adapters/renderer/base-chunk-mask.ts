import { DataTexture, NearestFilter, RedFormat, UnsignedByteType, Vector3 } from 'three';
import type { MeshStandardMaterial } from 'three';
import type { VoxelResult } from '../../core/types.ts';

/** Hide only replaced fragments of the immutable base; large greedy faces need no CPU splitting. */
export class BaseChunkMask {
  private data = new Uint8Array(1);
  private texture?: DataTexture;
  private span = new Vector3(1, 1, 1);
  private width = 1;
  private marked = new Set<string>();
  private restore?: () => void;
  configure(base: VoxelResult | undefined, material: MeshStandardMaterial | undefined): void {
    this.dispose(); if (!base || !material) return;
    this.span.set(Math.ceil(base.size.width / 16), Math.ceil(base.size.height / 16), Math.ceil(base.size.length / 16));
    const count = this.span.x * this.span.y * this.span.z; this.width = Math.min(4096, count);
    const height = Math.ceil(count / this.width); this.data = new Uint8Array(this.width * height);
    this.texture = new DataTexture(this.data, this.width, height, RedFormat, UnsignedByteType);
    this.texture.magFilter = NearestFilter; this.texture.minFilter = NearestFilter; this.texture.needsUpdate = true;
    const compile = material.onBeforeCompile, key = material.customProgramCacheKey.bind(material);
    this.restore = () => { material.onBeforeCompile = compile; material.customProgramCacheKey = key; material.needsUpdate = true; };
    const texture = this.texture, span = this.span.clone(), width = this.width;
    material.customProgramCacheKey = () => `${key()}-editable-base`;
    material.onBeforeCompile = (shader, renderer) => {
      compile.call(material, shader, renderer);
      shader.uniforms.uEditedChunks = { value: texture }; shader.uniforms.uChunkSpan = { value: span };
      shader.uniforms.uChunkTextureSize = { value: [width, height] };
      shader.vertexShader = `varying vec3 vBasePoint;\n${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBasePoint = position - normal * 0.001;');
      shader.fragmentShader = `varying vec3 vBasePoint; uniform sampler2D uEditedChunks; uniform vec3 uChunkSpan; uniform vec2 uChunkTextureSize;\n${shader.fragmentShader}`
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          vec3 chunk = floor(vBasePoint / 16.0);
          if (all(greaterThanEqual(chunk, vec3(0.0))) && all(lessThan(chunk, uChunkSpan))) {
            float index = chunk.x + chunk.z * uChunkSpan.x + chunk.y * uChunkSpan.x * uChunkSpan.z;
            vec2 uv = (vec2(mod(index, uChunkTextureSize.x), floor(index / uChunkTextureSize.x)) + 0.5) / uChunkTextureSize;
            if (texture2D(uEditedChunks, uv).r > 0.5) discard;
          }`);
    };
    material.needsUpdate = true;
  }
  mark(keys: string[]): void {
    if (!this.texture) return;
    for (const key of keys) {
      if (this.marked.has(key)) continue; this.marked.add(key);
      const [x, y, z] = key.split(',').map(Number);
      if (x < 0 || y < 0 || z < 0 || x >= this.span.x || y >= this.span.y || z >= this.span.z) continue;
      this.data[x + z * this.span.x + y * this.span.x * this.span.z] = 255;
    }
    this.texture.needsUpdate = true;
  }
  dispose(): void { this.restore?.(); this.restore = undefined; this.texture?.dispose(); this.texture = undefined; this.marked.clear(); }
}
