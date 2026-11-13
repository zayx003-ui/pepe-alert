/**
 * Moteur de rendu : création du moteur Babylon, de la scène, du brouillard et
 * de la chaîne de post-traitement. Trois niveaux de qualité.
 */
import { Engine } from '@babylonjs/core/Engines/engine';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import '@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent';
import '@babylonjs/core/Rendering/depthRendererSceneComponent';
import { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Quality } from '../config/settings';
import type { LightBudget } from './lighting';

export interface QualityProfile {
  textureSize: number;
  light: LightBudget;
  postProcess: boolean;
  bloom: boolean;
  particles: number;
  /** Facteur d'échelle matérielle supplémentaire (>1 = rendu sous-échantillonné). */
  scaling: number;
  fogDensity: number;
}

export const QUALITY: Record<Quality, QualityProfile> = {
  faible: {
    textureSize: 128,
    light: { pool: 2, remote: 0, shadows: false, shadowSize: 512 },
    postProcess: false,
    bloom: false,
    particles: 0,
    scaling: 1.5,
    fogDensity: 0.05,
  },
  moyenne: {
    textureSize: 256,
    light: { pool: 4, remote: 1, shadows: true, shadowSize: 1024 },
    postProcess: true,
    bloom: true,
    particles: 120,
    scaling: 1,
    fogDensity: 0.042,
  },
  elevee: {
    textureSize: 512,
    light: { pool: 6, remote: 2, shadows: true, shadowSize: 2048 },
    postProcess: true,
    bloom: true,
    particles: 260,
    scaling: 1,
    fogDensity: 0.04,
  },
};

export class Renderer {
  readonly engine: Engine;
  scene: Scene;
  pipeline: DefaultRenderingPipeline | null = null;
  readonly profile: QualityProfile;
  private onResize = (): void => this.engine.resize();

  constructor(
    readonly canvas: HTMLCanvasElement,
    quality: Quality,
    renderScale: number,
  ) {
    this.profile = QUALITY[quality];
    this.engine = new Engine(canvas, false, { preserveDrawingBuffer: false, stencil: false, powerPreference: 'high-performance', audioEngine: false }, false);
    this.engine.setHardwareScalingLevel(this.profile.scaling / Math.max(0.5, Math.min(1, renderScale)));
    this.scene = this.createScene();
    window.addEventListener('resize', this.onResize);
  }

  private createScene(): Scene {
    const scene = new Scene(this.engine);
    scene.clearColor = new Color4(0, 0, 0, 1);
    scene.ambientColor = new Color3(0, 0, 0);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = this.profile.fogDensity;
    scene.fogColor = new Color3(0.012, 0.014, 0.018);
    scene.skipPointerMovePicking = true;
    // Les entrées sont gérées par InputManager : la scène ne doit pas capter (ni bloquer) les clics.
    scene.detachControl();
    scene.autoClearDepthAndStencil = true;
    // Sans post-traitement, le rendu tonal est porté par les matériaux eux-mêmes.
    const ip = scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.25;
    ip.contrast = 1.15;
    return scene;
  }

  /** Remplace la scène (nouvelle expédition). */
  resetScene(): Scene {
    this.pipeline?.dispose();
    this.pipeline = null;
    this.scene.dispose();
    this.scene = this.createScene();
    return this.scene;
  }

  /** Active la chaîne de post-traitement pour la caméra donnée. */
  attachPipeline(camera: Camera): void {
    if (!this.profile.postProcess) return;
    const p = new DefaultRenderingPipeline('nocturne', true, this.scene, [camera]);
    p.fxaaEnabled = true;
    p.bloomEnabled = this.profile.bloom;
    p.bloomThreshold = 0.62;
    p.bloomWeight = 0.42;
    p.bloomKernel = 48;
    p.bloomScale = 0.5;
    p.grainEnabled = true;
    p.grain.intensity = 9;
    p.grain.animated = true;
    p.chromaticAberrationEnabled = true;
    p.chromaticAberration.aberrationAmount = 0;
    p.imageProcessingEnabled = true;
    p.imageProcessing.toneMappingEnabled = true;
    p.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    p.imageProcessing.exposure = 1.25;
    p.imageProcessing.contrast = 1.15;
    p.imageProcessing.vignetteEnabled = true;
    p.imageProcessing.vignetteWeight = 2;
    p.imageProcessing.vignetteColor = new Color4(0, 0, 0, 1);
    p.imageProcessing.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
    this.pipeline = p;
  }

  /** Altérations de l'image liées à l'état du joueur (jamais des commandes). */
  setPerception(vignette: number, aberration: number, desaturate: number, blur: number): void {
    const p = this.pipeline;
    if (!p) return;
    p.imageProcessing.vignetteWeight = 1.5 + vignette * 9;
    p.chromaticAberration.aberrationAmount = aberration * 42 + blur * 30;
    p.imageProcessing.colorCurvesEnabled = false;
    p.imageProcessing.contrast = 1.15 + desaturate * 0.25;
    p.imageProcessing.exposure = 1.25 - desaturate * 0.25;
    p.grain.intensity = 9 + aberration * 14 + blur * 10;
  }

  start(frame: (dt: number) => void): void {
    this.engine.runRenderLoop(() => {
      // Pas de temps borné : un onglet remis au premier plan ne provoque pas de saut.
      const dt = Math.min(0.05, this.engine.getDeltaTime() / 1000);
      frame(dt);
      if (this.scene.activeCamera) this.scene.render();
    });
  }

  stop(): void {
    this.engine.stopRenderLoop();
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.stop();
    this.pipeline?.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }
}
