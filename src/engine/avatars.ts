/**
 * Corps visibles : coéquipiers, entités et mirages. Construits à partir de
 * primitives et animés par code (démarche, posture, attaque).
 */
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { EntityKind } from '../ai/specs';
import type { MaterialLibrary } from './materials';

function box(scene: Scene, parent: TransformNode, mat: PBRMaterial | StandardMaterial, w: number, h: number, d: number, x: number, y: number, z: number): Mesh {
  const m = MeshBuilder.CreateBox('partie', { width: w, height: h, depth: d }, scene);
  m.material = mat;
  m.parent = parent;
  m.position.set(x, y, z);
  m.isPickable = false;
  return m;
}

/** Membre articulé : pivot en haut, la boîte pend en dessous. */
function limb(scene: Scene, parent: TransformNode, mat: PBRMaterial | StandardMaterial, w: number, len: number, x: number, y: number, z: number): TransformNode {
  const pivot = new TransformNode('pivot', scene);
  pivot.parent = parent;
  pivot.position.set(x, y, z);
  box(scene, pivot, mat, w, len, w, 0, -len / 2, 0);
  return pivot;
}

/* ------------------------------------------------------------------ */
/* Joueurs                                                             */
/* ------------------------------------------------------------------ */

export class PlayerAvatar {
  readonly root: TransformNode;
  private torso: TransformNode;
  private legs: TransformNode[] = [];
  private arms: TransformNode[] = [];
  private lens: Mesh;
  private label: Mesh | null = null;
  private suit: PBRMaterial;
  private labelTexture: DynamicTexture | null = null;
  private labelMaterial: StandardMaterial | null = null;
  private phase = 0;
  private lying = 0;

  constructor(scene: Scene, lib: MaterialLibrary, name: string, color: string) {
    this.root = new TransformNode(`joueur:${name}`, scene);
    this.suit = lib.get('fabric_dark').clone(`tenue:${name}`);
    this.suit.albedoColor = Color3.FromHexString(color.length === 7 ? color : '#8a8f98').scale(0.8);
    const dark = lib.get('plastic');
    this.torso = new TransformNode('torse', scene);
    this.torso.parent = this.root;
    this.torso.position.y = 0.85;
    box(scene, this.torso, this.suit, 0.44, 0.62, 0.24, 0, 0.33, 0);
    box(scene, this.torso, dark, 0.34, 0.42, 0.14, 0, 0.36, -0.18);
    box(scene, this.torso, dark, 0.24, 0.26, 0.26, 0, 0.8, 0);
    const visor = lib.emissive('visiere', 0.12, 0.2, 0.22);
    box(scene, this.torso, visor, 0.2, 0.09, 0.02, 0, 0.82, 0.135);
    this.lens = box(scene, this.torso, lib.emissive('lentille', 1, 0.95, 0.8), 0.06, 0.06, 0.03, 0.17, 0.5, 0.14);
    for (const sx of [-1, 1]) {
      this.legs.push(limb(scene, this.root, this.suit, 0.17, 0.85, sx * 0.12, 0.87, 0));
      this.arms.push(limb(scene, this.torso, this.suit, 0.12, 0.6, sx * 0.29, 0.6, 0));
    }
    if (name) {
      const tex = new DynamicTexture(`nom:${name}`, { width: 256, height: 48 }, scene, true);
      const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
      ctx.clearRect(0, 0, 256, 48);
      ctx.font = 'bold 26px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(230,225,210,0.9)';
      ctx.fillText(name, 128, 26, 240);
      tex.update();
      tex.hasAlpha = true;
      const mat = new StandardMaterial(`nom:${name}`, scene);
      mat.disableLighting = true;
      mat.emissiveTexture = tex;
      mat.opacityTexture = tex;
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      mat.backFaceCulling = false;
      const plane = MeshBuilder.CreatePlane(`nom:${name}`, { width: 0.9, height: 0.17 }, scene);
      plane.material = mat;
      plane.parent = this.root;
      plane.position.y = 2.05;
      plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
      plane.isPickable = false;
      this.label = plane;
      this.labelTexture = tex;
      this.labelMaterial = mat;
    }
  }

  get meshes(): Mesh[] {
    return this.root.getChildMeshes(false).filter((m) => m !== this.label) as Mesh[];
  }

  update(dt: number, x: number, y: number, z: number, yaw: number, speed: number, crouching: boolean, lightOn: boolean, alive: boolean, visible: boolean, labelVisible: boolean): void {
    this.root.setEnabled(visible);
    if (!visible) return;
    this.lying += ((alive ? 0 : 1) - this.lying) * Math.min(1, dt * 4);
    this.root.position.set(x, y + this.lying * 0.14, z);
    this.root.rotation.y = yaw;
    this.root.rotation.x = -this.lying * (Math.PI / 2);
    const crouch = crouching && alive ? 0.62 : 1;
    this.torso.position.y += (0.85 * crouch - this.torso.position.y) * Math.min(1, dt * 8);
    this.torso.rotation.x = crouching && alive ? 0.35 : 0;
    this.phase += dt * Math.min(speed, 5.5) * 2.4;
    const swing = alive ? Math.sin(this.phase) * Math.min(1, speed / 2.5) * 0.7 : 0;
    this.legs[0]!.rotation.x = swing;
    this.legs[1]!.rotation.x = -swing;
    this.legs[0]!.scaling.y = this.legs[1]!.scaling.y = crouch;
    this.arms[0]!.rotation.x = -swing * 0.7;
    this.arms[1]!.rotation.x = swing * 0.7 - (lightOn ? 1.1 : 0);
    this.lens.setEnabled(lightOn && alive);
    if (this.label) this.label.setEnabled(labelVisible && alive);
  }

  dispose(): void {
    this.root.dispose(false, false);
    this.suit.dispose();
    this.labelTexture?.dispose();
    this.labelMaterial?.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Entités                                                             */
/* ------------------------------------------------------------------ */

export class EntityAvatar {
  readonly root: TransformNode;
  private parts: TransformNode[] = [];
  private blobs: Mesh[] = [];
  private phase = Math.random() * 10;
  private fade = 0;
  private ghost: StandardMaterial | null = null;

  constructor(
    scene: Scene,
    lib: MaterialLibrary,
    readonly kind: EntityKind,
  ) {
    const root = new TransformNode(`entite:${kind}`, scene);
    this.root = root;
    const eye = lib.emissive('oeil', 0.9, 0.9, 0.85);
    switch (kind) {
      case 'visiteur': {
        const skin = lib.get('skin_dark');
        box(scene, root, skin, 0.3, 1.0, 0.2, 0, 1.5, 0);
        box(scene, root, skin, 0.2, 0.36, 0.22, 0, 2.2, 0.02);
        box(scene, root, eye, 0.025, 0.025, 0.01, -0.045, 2.24, 0.135);
        box(scene, root, eye, 0.025, 0.025, 0.01, 0.045, 2.24, 0.135);
        for (const sx of [-1, 1]) {
          this.parts.push(limb(scene, root, skin, 0.07, 1.35, sx * 0.21, 1.95, 0));
          this.parts.push(limb(scene, root, skin, 0.1, 1.02, sx * 0.09, 1.02, 0));
        }
        break;
      }
      case 'echo': {
        const skin = lib.get('skin_pale');
        const torso = new TransformNode('torse', scene);
        torso.parent = root;
        torso.position.set(0, 1.05, 0);
        torso.rotation.x = 0.55;
        box(scene, torso, skin, 0.5, 0.8, 0.34, 0, 0.3, 0);
        // Tête sans yeux, bordée de lames auditives.
        box(scene, torso, skin, 0.24, 0.24, 0.3, 0, 0.82, 0.08);
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI - Math.PI / 2;
          const blade = box(scene, torso, skin, 0.03, 0.32, 0.16, Math.sin(a) * 0.2, 0.84 + Math.cos(a) * 0.12, 0.02);
          blade.rotation.z = -a;
        }
        for (const sx of [-1, 1]) {
          this.parts.push(limb(scene, torso, skin, 0.09, 1.0, sx * 0.3, 0.6, 0.05));
          this.parts.push(limb(scene, root, skin, 0.12, 1.0, sx * 0.15, 1.0, -0.1));
        }
        break;
      }
      case 'phototrope': {
        const glow = new StandardMaterial('phototrope', scene);
        glow.disableLighting = true;
        glow.emissiveColor = new Color3(0.55, 0.62, 0.7);
        glow.alpha = 0.55;
        this.ghost = glow;
        for (let i = 0; i < 5; i++) {
          const s = MeshBuilder.CreateSphere('lobe', { diameter: 0.75 - i * 0.1, segments: 8 }, scene);
          s.material = glow;
          s.parent = root;
          s.position.set(Math.sin(i * 2.1) * 0.12, 0.45 + i * 0.3, Math.cos(i * 1.7) * 0.12);
          s.isPickable = false;
          this.blobs.push(s);
        }
        break;
      }
      case 'rampant': {
        const skin = lib.get('skin_red');
        box(scene, root, skin, 0.5, 0.24, 1.1, 0, 0.3, 0);
        box(scene, root, skin, 0.3, 0.2, 0.34, 0, 0.36, 0.66);
        box(scene, root, eye, 0.03, 0.03, 0.01, -0.07, 0.4, 0.835);
        box(scene, root, eye, 0.03, 0.03, 0.01, 0.07, 0.4, 0.835);
        for (let i = 0; i < 3; i++) {
          for (const sx of [-1, 1]) {
            const leg = limb(scene, root, skin, 0.06, 0.55, sx * 0.27, 0.36, -0.35 + i * 0.35);
            leg.rotation.z = sx * 1.1;
            this.parts.push(leg);
          }
        }
        break;
      }
      case 'porteur': {
        const skin = lib.get('skin_sick');
        const growth = lib.get('organic');
        const torso = new TransformNode('torse', scene);
        torso.parent = root;
        torso.position.set(0, 0.9, 0);
        torso.rotation.x = 0.2;
        torso.rotation.z = 0.12;
        box(scene, torso, skin, 0.42, 0.62, 0.24, 0, 0.3, 0);
        box(scene, torso, skin, 0.22, 0.24, 0.22, 0.04, 0.76, 0.03);
        for (const [x, y, z, d] of [[0.2, 0.62, 0, 0.3], [-0.1, 0.9, -0.05, 0.24], [0.05, 0.3, 0.14, 0.26]] as const) {
          const s = MeshBuilder.CreateSphere('excroissance', { diameter: d, segments: 6 }, scene);
          s.material = growth;
          s.parent = torso;
          s.position.set(x, y, z);
          s.isPickable = false;
        }
        for (const sx of [-1, 1]) {
          this.parts.push(limb(scene, torso, skin, 0.11, 0.62, sx * 0.28, 0.56, 0));
          this.parts.push(limb(scene, root, skin, 0.15, 0.9, sx * 0.12, 0.9, 0));
        }
        break;
      }
      case 'statique': {
        const mat = new StandardMaterial('statique', scene);
        mat.disableLighting = true;
        mat.emissiveColor = new Color3(0.35, 0.6, 1);
        mat.alpha = 0.1;
        mat.backFaceCulling = false;
        this.ghost = mat;
        for (let i = 0; i < 6; i++) {
          const p = MeshBuilder.CreatePlane('voile', { width: 0.5 + (i % 3) * 0.2, height: 1.5 }, scene);
          p.material = mat;
          p.parent = root;
          p.position.set(0, 0.95, 0);
          p.rotation.y = (i / 6) * Math.PI;
          p.isPickable = false;
          this.blobs.push(p);
        }
        break;
      }
    }
  }

  get meshes(): Mesh[] {
    return this.kind === 'phototrope' || this.kind === 'statique' ? [] : (this.root.getChildMeshes(false) as Mesh[]);
  }

  /**
   * `reveal` : pour le Statique, visibilité accrue quand l'appareil de mesure est allumé.
   */
  update(dt: number, x: number, y: number, z: number, yaw: number, anim: number, visible: boolean, reveal: number): void {
    this.fade += ((visible ? 1 : 0) - this.fade) * Math.min(1, dt * 5);
    const shown = this.fade > 0.03;
    this.root.setEnabled(shown);
    if (!shown) return;
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    this.phase += dt * (anim === 2 ? 11 : anim === 1 ? 5 : 1.2);
    const t = this.phase;
    const amp = anim === 0 ? 0.04 : anim === 2 ? 0.9 : 0.5;
    switch (this.kind) {
      case 'visiteur':
        // Bras : indices 0 et 2 ; jambes : 1 et 3. Bras tendus pendant l'attaque.
        this.parts[0]!.rotation.x = anim === 3 ? -1.5 : Math.sin(t) * amp * 0.5;
        this.parts[2]!.rotation.x = anim === 3 ? -1.4 : -Math.sin(t) * amp * 0.5;
        this.parts[1]!.rotation.x = -Math.sin(t) * amp * 0.6;
        this.parts[3]!.rotation.x = Math.sin(t) * amp * 0.6;
        this.root.rotation.z = Math.sin(t * 0.3) * 0.02;
        this.root.scaling.y = this.fade;
        break;
      case 'echo':
      case 'porteur':
        this.parts[0]!.rotation.x = anim === 3 ? -1.6 : Math.sin(t) * amp * 0.6 - (this.kind === 'porteur' ? 0.9 : 0.2);
        this.parts[2]!.rotation.x = anim === 3 ? -1.6 : -Math.sin(t) * amp * 0.6 - 0.2;
        this.parts[1]!.rotation.x = -Math.sin(t) * amp * 0.7;
        this.parts[3]!.rotation.x = Math.sin(t) * amp * 0.7;
        break;
      case 'rampant':
        this.parts.forEach((leg, i) => {
          leg.rotation.x = Math.sin(t * 1.6 + i * 1.3) * amp * 0.8;
        });
        break;
      case 'phototrope':
        this.blobs.forEach((b, i) => {
          const s = 1 + Math.sin(t * 0.9 + i * 1.4) * 0.12;
          b.scaling.set(s, s, s);
          b.position.x = Math.sin(t * 0.5 + i * 2.1) * 0.14;
        });
        if (this.ghost) this.ghost.alpha = (0.4 + Math.sin(t * 1.3) * 0.12) * this.fade;
        break;
      case 'statique':
        this.blobs.forEach((b, i) => {
          b.rotation.y += dt * (0.6 + i * 0.25);
          b.scaling.y = 0.8 + Math.sin(t * 9 + i * 3) * 0.25;
        });
        if (this.ghost) this.ghost.alpha = (0.035 + reveal * 0.3 + (Math.sin(t * 31) > 0.92 ? 0.12 : 0)) * this.fade;
        break;
    }
  }

  dispose(): void {
    this.root.dispose(false, false);
    this.ghost?.dispose();
  }
}
