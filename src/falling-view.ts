import { BoxGeometry, InstancedBufferAttribute, InstancedBufferGeometry, InstancedInterleavedBuffer, InterleavedBufferAttribute, Mesh, MeshStandardMaterial } from 'three';
import type { FallingData } from './types.ts';

export class FallingAnimation {
  readonly mesh: Mesh<InstancedBufferGeometry, MeshStandardMaterial>;
  readonly duration = 3.6;
  private time = { value: 0 };

  constructor(data: FallingData, height: number, texturedMaterial?: MeshStandardMaterial) {
    const box = new BoxGeometry(1, 1, 1), geometry = new InstancedBufferGeometry();
    geometry.setIndex(box.index);
    for (const name of ['position', 'normal', 'uv']) geometry.setAttribute(name, box.getAttribute(name));
    geometry.setAttribute('aBlockCenter', new InstancedBufferAttribute(data.centers, 3));
    geometry.setAttribute('aBlockSize', new InstancedBufferAttribute(data.sizes, 3));
    geometry.setAttribute('aBlockAnchor', new InstancedBufferAttribute(data.anchors, 3));
    geometry.setAttribute('color', new InstancedBufferAttribute(data.colors, 3));
    if (data.textures) {
      const tiles = new InstancedInterleavedBuffer(data.textures, 6);
      geometry.setAttribute('aTilesA', new InterleavedBufferAttribute(tiles, 3, 0));
      geometry.setAttribute('aTilesB', new InterleavedBufferAttribute(tiles, 3, 3));
    }
    geometry.instanceCount = data.centers.length / 3;
    const material = texturedMaterial ?? new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    const textureShader = material.onBeforeCompile.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      textureShader(shader, renderer);
      shader.uniforms.uDropTime = this.time;
      shader.uniforms.uModelHeight = { value: Math.max(1, height) };
      shader.uniforms.uDropDistance = { value: Math.max(8, Math.min(36, height * 0.18)) };
      shader.vertexShader = `attribute vec3 aBlockCenter;
        attribute vec3 aBlockSize;
        attribute vec3 aBlockAnchor;
        uniform float uDropTime;
        uniform float uModelHeight;
        uniform float uDropDistance;
        ${shader.vertexShader}`
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float blockRandom = fract(sin(dot(aBlockAnchor, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float blockDelay = max(0.0, aBlockAnchor.y - 0.5) / uModelHeight * 2.4 + blockRandom * 0.45;
          float blockElapsed = uDropTime - blockDelay;
          float fallProgress = clamp(blockElapsed / 0.52, 0.0, 1.0);
          float dropOffset = uDropDistance * (1.0 - fallProgress * fallProgress);
          if (blockElapsed > 0.52) dropOffset = sin(clamp((blockElapsed - 0.52) / 0.18, 0.0, 1.0) * 3.14159265) * 0.08;
          transformed *= aBlockSize;
          transformed += aBlockCenter;
          transformed.y += dropOffset;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
          if (blockElapsed < 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`);
    };
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    box.dispose();
  }

  update(elapsed: number): boolean { this.time.value = elapsed; return elapsed >= this.duration; }
  dispose(): void { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
