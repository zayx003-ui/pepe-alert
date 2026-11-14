/**
 * Bibliothèque de matériaux PBR. Les textures sont générées une seule fois et
 * partagées : un matériau « teinté » réutilise le jeu de textures d'un autre.
 */
import { Constants } from '@babylonjs/core/Engines/constants';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { RawCubeTexture } from '@babylonjs/core/Materials/Textures/rawCubeTexture';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { SECTORS } from '../world/sectors';
import { generateTexture, type TextureSet } from './textures';

interface MatSpec {
  tex: string;
  tint?: [number, number, number];
  /** Multiplicateurs appliqués à la rugosité / au métal de la texture. */
  rough?: number;
  metal?: number;
  emissive?: [number, number, number];
  alpha?: number;
  decal?: boolean;
  doubleSided?: boolean;
}

/** Matériaux nommés utilisés par le décor, les machines et les personnages. */
const SPECS: Record<string, MatSpec> = {
  wall_concrete: { tex: 'concrete' },
  wall_panel: { tex: 'wall_panel' },
  wall_tile: { tex: 'wall_tile' },
  wall_metal: { tex: 'wall_metal' },
  wall_foam: { tex: 'wall_foam' },
  floor_concrete: { tex: 'floor_concrete' },
  floor_tile: { tex: 'floor_tile' },
  floor_metal: { tex: 'floor_metal' },
  floor_grate: { tex: 'floor_grate' },
  floor_carpet: { tex: 'floor_carpet' },
  ceiling: { tex: 'ceiling' },
  conduit: { tex: 'wall_metal', tint: [0.55, 0.55, 0.6] },
  metal: { tex: 'metal', tint: [0.55, 0.56, 0.6] },
  metal_dark: { tex: 'metal', tint: [0.16, 0.17, 0.19], rough: 1.2 },
  steel: { tex: 'metal', tint: [0.75, 0.78, 0.8], rough: 0.7 },
  rust: { tex: 'wall_metal', tint: [1.1, 0.75, 0.55] },
  painted_grey: { tex: 'painted', tint: [0.42, 0.44, 0.46] },
  painted_white: { tex: 'painted', tint: [0.82, 0.83, 0.8] },
  painted_green: { tex: 'painted', tint: [0.2, 0.36, 0.27] },
  painted_red: { tex: 'painted', tint: [0.5, 0.1, 0.08] },
  painted_yellow: { tex: 'painted', tint: [0.72, 0.52, 0.08] },
  painted_blue: { tex: 'painted', tint: [0.15, 0.25, 0.42] },
  painted_dark: { tex: 'painted', tint: [0.1, 0.11, 0.12] },
  plastic: { tex: 'painted', tint: [0.06, 0.06, 0.07], rough: 0.7, metal: 0 },
  rubber: { tex: 'fabric', tint: [0.05, 0.05, 0.05] },
  wood: { tex: 'wood' },
  fabric_dark: { tex: 'fabric', tint: [0.12, 0.13, 0.16] },
  fabric_green: { tex: 'fabric', tint: [0.2, 0.3, 0.26] },
  fabric_white: { tex: 'fabric', tint: [0.7, 0.7, 0.66] },
  paper: { tex: 'fabric', tint: [0.8, 0.78, 0.7] },
  foam: { tex: 'wall_foam' },
  organic: { tex: 'organic', emissive: [0.05, 0.005, 0.01] },
  hazard: { tex: 'hazard' },
  glass: { tex: 'metal', tint: [0.3, 0.45, 0.45], rough: 0.15, metal: 0, alpha: 0.28, doubleSided: true },
  skin_pale: { tex: 'organic', tint: [1.6, 2.4, 2.2], rough: 1.6 },
  skin_dark: { tex: 'organic', tint: [0.18, 0.2, 0.22], rough: 1.2 },
  skin_sick: { tex: 'organic', tint: [0.7, 1.9, 0.9], rough: 1.4 },
  skin_red: { tex: 'organic', tint: [1.0, 0.6, 0.5], rough: 1.3 },
  decal_blood: { tex: 'decal_blood', decal: true },
  decal_trail: { tex: 'decal_trail', decal: true },
  decal_puddle: { tex: 'decal_puddle', decal: true },
  decal_papers: { tex: 'decal_papers', decal: true },
};

export class MaterialLibrary {
  private textures = new Map<string, { albedo: RawTexture; normal: RawTexture; orm: RawTexture; set: TextureSet }>();
  private materials = new Map<string, PBRMaterial>();
  private emissives = new Map<string, StandardMaterial>();
  screenTexture: RawTexture | null = null;

  constructor(
    private scene: Scene,
    private textureSize: number,
    public maxLights: number,
  ) {
    this.buildEnvironment();
  }

  /** Petite carte d'environnement sombre : donne des reflets aux métaux et aux surfaces humides. */
  private buildEnvironment(): void {
    const size = 16;
    const faces: Uint8Array[] = [];
    for (let f = 0; f < 6; f++) {
      const data = new Uint8Array(size * size * 4);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 4;
          // Plafond (+Y) légèrement plus clair : évoque des néons lointains.
          const top = f === 2 ? 1 : f === 3 ? 0.15 : 0.35 + (1 - y / size) * 0.35;
          const streak = f !== 2 && f !== 3 && x % 5 === 0 ? 1.5 : 1;
          const v = Math.min(255, 26 * top * streak);
          data[i] = v * 0.85;
          data[i + 1] = v * 0.95;
          data[i + 2] = v * 1.05;
          data[i + 3] = 255;
        }
      }
      faces.push(data);
    }
    const cube = new RawCubeTexture(this.scene, faces, size, Constants.TEXTUREFORMAT_RGBA, Constants.TEXTURETYPE_UNSIGNED_BYTE, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    this.scene.environmentTexture = cube;
    this.scene.environmentIntensity = 0.55;
  }

  private texture(name: string): { albedo: RawTexture; normal: RawTexture; orm: RawTexture; set: TextureSet } {
    let t = this.textures.get(name);
    if (!t) {
      const set = generateTexture(name, this.textureSize);
      const make = (data: Uint8Array, linear: boolean): RawTexture => {
        const tex = RawTexture.CreateRGBATexture(data, set.size, set.size, this.scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
        tex.wrapU = Texture.WRAP_ADDRESSMODE;
        tex.wrapV = Texture.WRAP_ADDRESSMODE;
        tex.anisotropicFilteringLevel = 4;
        tex.gammaSpace = !linear;
        if (!set.alpha) {
          tex.uScale = 1 / set.tile;
          tex.vScale = 1 / set.tile;
        }
        return tex;
      };
      t = { albedo: make(set.albedo, false), normal: make(set.normal, true), orm: make(set.orm, true), set };
      t.albedo.hasAlpha = set.alpha;
      this.textures.set(name, t);
    }
    return t;
  }

  get(name: string): PBRMaterial {
    let m = this.materials.get(name);
    if (m) return m;
    let spec = SPECS[name];
    if (!spec && name.startsWith('accent_')) {
      const sector = SECTORS.find((s) => s.id === name.slice(7));
      spec = { tex: 'painted', tint: sector ? [sector.accent[0] * 0.75, sector.accent[1] * 0.75, sector.accent[2] * 0.75] : [0.5, 0.5, 0.5] };
    }
    if (!spec) throw new Error(`Matériau inconnu : ${name}`);
    const tex = this.texture(spec.tex);
    m = new PBRMaterial(name, this.scene);
    m.albedoTexture = tex.albedo;
    m.bumpTexture = tex.normal;
    m.metallicTexture = tex.orm;
    m.useRoughnessFromMetallicTextureGreen = true;
    m.useMetallnessFromMetallicTextureBlue = true;
    m.useAmbientOcclusionFromMetallicTextureRed = true;
    m.useRoughnessFromMetallicTextureAlpha = false;
    m.metallic = spec.metal ?? 1;
    m.roughness = spec.rough ?? 1;
    if (spec.tint) m.albedoColor = new Color3(spec.tint[0], spec.tint[1], spec.tint[2]);
    if (spec.emissive) m.emissiveColor = new Color3(spec.emissive[0], spec.emissive[1], spec.emissive[2]);
    m.maxSimultaneousLights = this.maxLights;
    // Atténuation par portée (et non physique) : plus simple à régler pour une ambiance sombre.
    m.usePhysicalLightFalloff = false;
    m.invertNormalMapX = false;
    m.invertNormalMapY = false;
    if (spec.alpha !== undefined) {
      m.alpha = spec.alpha;
      m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    }
    if (spec.doubleSided) m.backFaceCulling = false;
    if (spec.decal) {
      m.useAlphaFromAlbedoTexture = true;
      m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
      m.zOffset = -3;
      m.bumpTexture = null;
      m.disableDepthWrite = true;
    }
    this.materials.set(name, m);
    return m;
  }

  /** Matériau auto-éclairé, insensible aux lumières (voyants, néons, yeux). */
  emissive(name: string, r: number, g: number, b: number, alpha = 1): StandardMaterial {
    let m = this.emissives.get(name);
    if (!m) {
      m = new StandardMaterial(name, this.scene);
      m.disableLighting = true;
      m.emissiveColor = new Color3(r, g, b);
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      if (alpha < 1) {
        m.alpha = alpha;
        m.backFaceCulling = false;
      }
      this.emissives.set(name, m);
    }
    return m;
  }

  /** Écran allumé (terminaux, consoles). */
  screen(): StandardMaterial {
    let m = this.emissives.get('screen');
    if (!m) {
      const set = generateTexture('screen', 256);
      const tex = RawTexture.CreateRGBATexture(set.albedo, set.size, set.size, this.scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
      this.screenTexture = tex;
      m = new StandardMaterial('screen', this.scene);
      m.disableLighting = true;
      m.emissiveTexture = tex;
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      this.emissives.set('screen', m);
    }
    return m;
  }

  setMaxLights(n: number): void {
    this.maxLights = n;
    for (const m of this.materials.values()) m.maxSimultaneousLights = n;
  }

  dispose(): void {
    for (const m of this.materials.values()) m.dispose();
    for (const m of this.emissives.values()) m.dispose();
    for (const t of this.textures.values()) {
      t.albedo.dispose();
      t.normal.dispose();
      t.orm.dispose();
    }
    this.screenTexture?.dispose();
    this.scene.environmentTexture?.dispose();
  }
}
