import { LinearMipmapLinearFilter, MeshStandardMaterial, NearestFilter, SRGBColorSpace, TextureLoader } from 'three';
import { ATLAS } from '../../core/texture-data.ts';

// The atlas stays shared across remeshes. A failed load keeps the representative colours visible.
export class BlockTextures {
  private ready = { value: 0 };
  private atlas = new TextureLoader().load('/textures/atlas.png', () => { this.ready.value = 1; });

  constructor() {
    this.atlas.colorSpace = SRGBColorSpace;
    this.atlas.magFilter = NearestFilter;
    this.atlas.minFilter = LinearMipmapLinearFilter;
    this.atlas.generateMipmaps = true;
    this.atlas.flipY = false;
  }

  material(instanced = false): MeshStandardMaterial {
    const material = new MeshStandardMaterial({ map: this.atlas, vertexColors: true, roughness: 0.92, metalness: 0, alphaTest: 0.1 });
    material.customProgramCacheKey = () => `block-atlas-${instanced ? 'falling' : 'surface'}-1`;
    material.onBeforeCompile = shader => {
      shader.uniforms.uAtlasReady = this.ready;
      shader.vertexShader = `varying vec3 vBlockTexture;
        ${instanced ? 'attribute vec3 aTilesA; attribute vec3 aTilesB;' : 'attribute vec3 aTexture;'}
        ${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>
          ${instanced ? `vec3 texturePoint = position * aBlockSize + aBlockCenter;
            float tile = normal.x > 0.5 ? aTilesA.x : normal.x < -0.5 ? aTilesA.y :
              normal.y > 0.5 ? aTilesA.z : normal.y < -0.5 ? aTilesB.x : normal.z > 0.5 ? aTilesB.y : aTilesB.z;
            float tileU = abs(normal.x) > 0.5 ? (normal.x > 0.0 ? -texturePoint.z : texturePoint.z) :
              normal.z < -0.5 ? -texturePoint.x : texturePoint.x;
            float tileV = abs(normal.y) > 0.5 ? (normal.y > 0.0 ? texturePoint.z : -texturePoint.z) : -texturePoint.y;
            vBlockTexture = vec3(tileU, tileV, tile);` : 'vBlockTexture = aTexture;'}
        `);
      shader.fragmentShader = `varying vec3 vBlockTexture;
        uniform float uAtlasReady;
        ${shader.fragmentShader}`
        .replace('#include <map_fragment>', `if (uAtlasReady > 0.5 && vBlockTexture.z > 0.5) {
          float tile = floor(vBlockTexture.z + 0.5);
          vec2 atlasCell = vec2(mod(tile, ${ATLAS.columns}.0), floor(tile / ${ATLAS.columns}.0));
          vec2 gradientX = dFdx(vBlockTexture.xy), gradientY = dFdy(vBlockTexture.xy);
          float footprint = max(length(gradientX), length(gradientY)) * ${ATLAS.tileSize}.0;
          float lod = clamp(log2(max(1.0, footprint)), 0.0, ${Math.log2(ATLAS.tileSize)}.0);
          float margin = 0.5 * exp2(ceil(lod));
          vec2 pixel = floor(fract(vBlockTexture.xy) * ${ATLAS.tileSize}.0) + 0.5;
          pixel = clamp(pixel, vec2(margin), vec2(${ATLAS.tileSize}.0 - margin));
          vec2 atlasUv = (atlasCell * ${ATLAS.tileSize}.0 + pixel) / vec2(${ATLAS.columns * ATLAS.tileSize}.0, ${ATLAS.rows * ATLAS.tileSize}.0);
          // Cap mip levels at one pixel per tile; neighbours never bleed into a face.
          float gradientScale = min(1.0, ${ATLAS.tileSize}.0 / max(1.0, footprint));
          vec2 atlasGrid = vec2(${ATLAS.columns}.0, ${ATLAS.rows}.0);
          diffuseColor *= textureGrad(map, atlasUv, gradientX * gradientScale / atlasGrid, gradientY * gradientScale / atlasGrid);
        }`)
        .replace('#include <color_fragment>', `if (uAtlasReady < 0.5 || vBlockTexture.z < 0.5) {
          #include <color_fragment>
        }`);
    };
    return material;
  }

  dispose(): void { this.atlas.dispose(); }
}
