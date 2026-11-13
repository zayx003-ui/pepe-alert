/**
 * Représentation 3D du complexe : géométrie statique par secteur (un maillage
 * par matériau), portes animées, objets, voyants des machines, ascenseur.
 */
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Meshes/instancedMesh';
import { doorCenter } from '../interaction/actions';
import { WALL_T } from '../world/dressing';
import { DOOR_AJAR, DOOR_OPEN, OPENING } from '../world/grid';
import { FIXTURE_SPECS } from '../world/props';
import { SECTORS, SECTOR_BY_ID } from '../world/sectors';
import type { WorldState } from '../world/state';
import { CELL, CellKind, DIR_DX, DIR_DY, EDGE_DOOR_BASE, EDGE_OPEN, EDGE_WALL, GRID_H, GRID_W, SLOT, type DoorDef, type Layout } from '../world/types';
import { GeoBatch } from './geometry';
import type { MaterialLibrary } from './materials';
import { drawFixture, drawProp } from './propMeshes';

interface DoorView {
  def: DoorDef;
  node: TransformNode;
  /** Ouverture animée, 0 (fermé) à 1 (ouvert). */
  open: number;
  lamp: InstancedMesh | null;
  planks: InstancedMesh | null;
  baseY: number;
  cx: number;
  cz: number;
}

interface StatusLed {
  id: string;
  mesh: InstancedMesh;
  screen: InstancedMesh | null;
}

const ITEM_SHAPES: Record<string, { mat: string; draw: (b: GeoBatch) => void }> = {
  lampe: { mat: 'metal_dark', draw: (b) => (b.cylinder('m', 0, 0.035, 0, 0.03, 0.2, 'x', 8), b.cylinder('m', 0.11, 0.035, 0, 0.045, 0.05, 'x', 8)) },
  radio: { mat: 'plastic', draw: (b) => (b.box('m', 0, 0.09, 0, 0.09, 0.18, 0.04), b.cylinder('m', 0.03, 0.24, 0, 0.006, 0.14, 'y', 5)) },
  medkit: { mat: 'painted_red', draw: (b) => (b.box('m', 0, 0.08, 0, 0.3, 0.16, 0.2), b.box('m', 0, 0.17, 0, 0.12, 0.02, 0.03)) },
  piles: { mat: 'painted_yellow', draw: (b) => (b.cylinder('m', 0, 0.02, -0.025, 0.02, 0.09, 'x', 7), b.cylinder('m', 0, 0.02, 0.025, 0.02, 0.09, 'x', 7)) },
  fusible: { mat: 'steel', draw: (b) => (b.cylinder('m', 0, 0.03, 0, 0.03, 0.14, 'x', 8), b.box('m', 0, 0.03, 0, 0.05, 0.07, 0.07)) },
  carte: { mat: 'painted_white', draw: (b) => b.box('m', 0, 0.006, 0, 0.09, 0.006, 0.055) },
  detecteur_mouvement: { mat: 'painted_green', draw: (b) => (b.box('m', 0, 0.05, 0, 0.12, 0.1, 0.2), b.box('m', 0, 0.12, -0.06, 0.1, 0.06, 0.02)) },
  detecteur_sonore: { mat: 'painted_blue', draw: (b) => (b.box('m', 0, 0.04, 0, 0.09, 0.08, 0.18), b.cylinder('m', 0, 0.04, 0.12, 0.035, 0.07, 'z', 8)) },
  camera: { mat: 'painted_dark', draw: (b) => (b.box('m', 0, 0.3, 0, 0.12, 0.1, 0.16), b.cylinder('m', 0, 0.3, 0.1, 0.035, 0.05, 'z', 8), b.cylinder('m', 0, 0.13, 0, 0.012, 0.26, 'y', 5)) },
  outils: { mat: 'painted_red', draw: (b) => (b.box('m', 0, 0.09, 0, 0.42, 0.18, 0.2), b.box('m', 0, 0.22, 0, 0.2, 0.03, 0.03)) },
  marqueurs: { mat: 'painted_green', draw: (b) => (b.cylinder('m', 0, 0.015, -0.02, 0.012, 0.16, 'x', 6), b.cylinder('m', 0, 0.015, 0.02, 0.012, 0.16, 'x', 6)) },
  mesureur: { mat: 'painted_yellow', draw: (b) => (b.box('m', 0, 0.035, 0, 0.1, 0.07, 0.2), b.cylinder('m', 0, 0.035, 0.14, 0.012, 0.1, 'z', 6)) },
  serum: { mat: 'painted_blue', draw: (b) => b.cylinder('m', 0, 0.02, 0, 0.018, 0.12, 'x', 7) },
  echantillon: { mat: 'organic', draw: (b) => b.cylinder('m', 0, 0.08, 0, 0.05, 0.16, 'y', 8) },
  disque: { mat: 'metal', draw: (b) => b.box('m', 0, 0.015, 0, 0.14, 0.03, 0.1) },
  bande: { mat: 'plastic', draw: (b) => (b.cylinder('m', 0, 0.012, 0, 0.09, 0.024, 'y', 12), b.cylinder('m', 0, 0.03, 0, 0.02, 0.02, 'y', 6)) },
  cellule: { mat: 'painted_yellow', draw: (b) => (b.cylinder('m', 0, 0.18, 0, 0.11, 0.36, 'y', 10), b.box('m', 0, 0.39, 0, 0.16, 0.04, 0.04)) },
  dossier: { mat: 'paper', draw: (b) => b.box('m', 0, 0.012, 0, 0.24, 0.024, 0.32) },
  document: { mat: 'paper', draw: (b) => b.box('m', 0, 0.004, 0, 0.21, 0.006, 0.29) },
};

export class WorldView {
  /** Maillages statiques de chaque secteur (pour l'occlusion par distance et les ombres). */
  readonly sectorMeshes: Mesh[][] = [];
  readonly shadowCasters: Mesh[] = [];
  private doors: DoorView[] = [];
  private leds: StatusLed[] = [];
  private items = new Map<number, InstancedMesh>();
  private itemSources = new Map<string, Mesh>();
  private markers = new Map<number, InstancedMesh>();
  private cameras = new Map<number, InstancedMesh>();
  private lightPanels: InstancedMesh[] = [];
  private sources: Mesh[] = [];
  private textures: DynamicTexture[] = [];
  private extraMaterials: StandardMaterial[] = [];
  private ledSource!: Mesh;
  private panelSource!: Mesh;
  private screenSource!: Mesh;
  private markerSource!: Mesh;
  private cameraSource!: Mesh;
  private plankSource!: Mesh;
  private leafSources = new Map<string, Mesh>();
  private cab: TransformNode | null = null;
  private coreMaterial: StandardMaterial;
  private cullTimer = 0;
  private time = 0;

  constructor(
    private scene: Scene,
    private lib: MaterialLibrary,
    private layout: Layout,
  ) {
    this.coreMaterial = lib.emissive('core', 0.6, 0.05, 0.05);
    this.buildSources();
    this.buildStatic();
    this.buildDoors();
    this.buildIndicators();
    this.buildElevator();
    this.buildSigns();
  }

  /* ================================================================ */
  /* Construction                                                      */
  /* ================================================================ */

  private special(name: string): StandardMaterial {
    switch (name) {
      case '$screen':
        return this.lib.screen();
      case '$led':
        return this.lib.emissive('led', 0.1, 0.9, 0.3);
      case '$red':
        return this.lib.emissive('red', 0.9, 0.08, 0.05);
      case '$blue':
        return this.lib.emissive('blue', 0.2, 0.5, 1);
      default:
        return this.coreMaterial;
    }
  }

  private finish(meshes: Map<string, Mesh>, shadows: boolean): Mesh[] {
    const out: Mesh[] = [];
    for (const [mat, mesh] of meshes) {
      if (mat.startsWith('$')) mesh.material = this.special(mat);
      else {
        mesh.material = this.lib.get(mat);
        mesh.receiveShadows = true;
        if (shadows && !mat.startsWith('decal') && mat !== 'glass') this.shadowCasters.push(mesh);
      }
      mesh.isPickable = false;
      mesh.freezeWorldMatrix();
      mesh.doNotSyncBoundingInfo = true;
      out.push(mesh);
    }
    return out;
  }

  private instanceColored(name: string, w: number, h: number, d: number): Mesh {
    const mesh = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this.scene);
    const mat = new StandardMaterial(name, this.scene);
    mat.disableLighting = true;
    mat.emissiveColor = Color3.White();
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mesh.material = mat;
    this.extraMaterials.push(mat);
    mesh.registerInstancedBuffer('color', 4);
    mesh.instancedBuffers['color'] = new Color4(0, 0, 0, 1);
    mesh.isVisible = false;
    mesh.isPickable = false;
    this.sources.push(mesh);
    return mesh;
  }

  private buildSources(): void {
    this.ledSource = this.instanceColored('led', 0.05, 0.05, 0.02);
    this.panelSource = this.instanceColored('neon', 1.1, 0.04, 0.26);
    this.markerSource = this.instanceColored('marqueur', 0.03, 0.03, 0.18);
    this.screenSource = MeshBuilder.CreatePlane('ecran', { width: 0.8, height: 0.42 }, this.scene);
    this.screenSource.material = this.lib.screen();
    this.screenSource.isVisible = false;
    this.sources.push(this.screenSource);

    const single = (name: string, mat: string, draw: (b: GeoBatch) => void): Mesh => {
      const b = new GeoBatch();
      draw(b);
      const mesh = b.build(this.scene, name).get('m')!;
      mesh.material = this.lib.get(mat);
      mesh.isVisible = false;
      mesh.isPickable = false;
      this.sources.push(mesh);
      return mesh;
    };
    for (const [id, shape] of Object.entries(ITEM_SHAPES)) this.itemSources.set(id, single(`objet:${id}`, shape.mat, shape.draw));
    this.cameraSource = single('camera-posee', 'painted_dark', ITEM_SHAPES['camera']!.draw);
    this.plankSource = single('planches', 'wood', (b) => {
      b.box('m', 0, 0.7, 0, 1.3, 0.14, 0.04);
      b.box('m', 0.02, 1.25, 0, 1.3, 0.14, 0.04);
      b.box('m', -0.03, 1.8, 0, 1.25, 0.14, 0.04);
      b.box('m', 0, 1.25, 0.03, 0.14, 1.5, 0.03);
    });
    // Battants : un maillage source par type, instancié pour chaque porte.
    const leaf = (key: string, mat: string, draw: (b: GeoBatch) => void): void => void this.leafSources.set(key, single(`battant:${key}`, mat, draw));
    const door = OPENING.door;
    leaf('door', 'painted_grey', (b) => {
      b.box('m', door.w / 2, door.h / 2, 0, door.w - 0.03, door.h - 0.03, 0.05);
      b.box('m', door.w - 0.12, 1.02, 0.04, 0.04, 0.03, 0.08);
      b.box('m', door.w - 0.12, 1.02, -0.04, 0.04, 0.03, 0.08);
      b.box('m', door.w / 2, 1.5, 0, door.w - 0.3, 0.5, 0.06);
    });
    const gate = OPENING.gate;
    leaf('gate', 'hazard', (b) => {
      b.box('m', 0, gate.h / 2, 0, gate.w - 0.02, gate.h - 0.02, 0.1);
      for (const y of [0.5, 1.2, 1.9]) b.box('m', 0, y, 0, gate.w - 0.1, 0.08, 0.14);
    });
    const vent = OPENING.vent;
    leaf('vent', 'metal_dark', (b) => {
      for (let i = 0; i < 7; i++) b.box('m', 0, 0.1 + i * 0.14, 0, vent.w - 0.04, 0.05, 0.03);
      b.box('m', -vent.w / 2 + 0.03, vent.h / 2, 0, 0.05, vent.h - 0.04, 0.04);
      b.box('m', vent.w / 2 - 0.03, vent.h / 2, 0, 0.05, vent.h - 0.04, 0.04);
    });
    const lift = OPENING.elevator;
    leaf('elevator', 'steel', (b) => b.box('m', 0, lift.h / 2, 0, lift.w - 0.02, lift.h - 0.02, 0.06));
    for (const wall of ['wall_concrete', 'wall_panel', 'wall_tile', 'wall_metal', 'wall_foam']) {
      leaf(`secret:${wall}`, wall, (b) => b.box('m', 0, OPENING.secret.h / 2, 0, OPENING.secret.w, OPENING.secret.h, 0.1));
    }
  }

  private buildStatic(): void {
    const l = this.layout;
    for (let s = 0; s < SECTORS.length; s++) {
      const def = SECTORS[s]!;
      const inst = l.sectors.find((x) => x.id === def.id)!;
      const b = new GeoBatch();
      const accent = `accent_${def.id}`;
      const trimmed = def.wall === 'wall_panel' || def.wall === 'wall_tile' || def.wall === 'wall_concrete';
      const x0 = inst.mx * SLOT;
      const y0 = inst.my * SLOT;
      for (let cy = y0; cy < y0 + SLOT; cy++) {
        for (let cx = x0; cx < x0 + SLOT; cx++) {
          const c = cy * GRID_W + cx;
          const kind = l.kind[c]!;
          if (kind === CellKind.Void) continue;
          const wx = cx * CELL + CELL / 2;
          const wz = cy * CELL + CELL / 2;
          const fy = l.floorY[c]!;
          const ch = l.ceilH[c]!;
          const conduit = kind === CellKind.Conduit;
          const floorMat = conduit ? 'conduit' : kind === CellKind.Stairs ? 'floor_metal' : def.floor;
          b.resetTransform();
          b.shade = 1;
          if (kind === CellKind.Stairs) this.stairs(b, c, wx, wz);
          else if (kind !== CellKind.Elevator) {
            b.box(floorMat, wx, fy - 0.05, wz, CELL, 0.1, CELL, 16);
            b.box(conduit ? 'conduit' : 'ceiling', wx, fy + ch + 0.05, wz, CELL, 0.1, CELL, 32);
          }
          this.walls(b, c, def.wall, accent, trimmed && !conduit && kind !== CellKind.Stairs);
        }
      }
      // Décor et machines.
      for (const p of l.props) {
        if (l.regions[p.region]!.sector !== def.id) continue;
        const fallen = p.type === 'chaise_tombee';
        b.shade = 1;
        b.setTransform(p.x, p.y, p.z, p.rot, 0, fallen ? 0.1 : 0);
        drawProp(b, p.type, p.variant, accent);
      }
      for (const f of l.fixtures) {
        if (f.sector !== def.id) continue;
        b.setTransform(f.x, f.y, f.z, f.rot);
        drawFixture(b, f.type, accent);
      }
      // Boîtiers des néons.
      for (const light of l.lights) {
        if (light.sector !== def.id) continue;
        b.setTransform(light.x, light.y, light.z, (light.id % 2) * (Math.PI / 2));
        b.box('metal_dark', 0, 0.05, 0, 1.2, 0.06, 0.34);
      }
      b.resetTransform();
      this.sectorMeshes[s] = this.finish(b.build(this.scene, def.id), true);
    }
  }

  /** Volée de marches (visuel) sur une cellule en pente. */
  private stairs(b: GeoBatch, c: number, wx: number, wz: number): void {
    const l = this.layout;
    const sx = l.slopeX[c]!;
    const sz = l.slopeZ[c]!;
    const mid = l.floorY[c]!;
    const along = sx !== 0;
    const steps = 8;
    const run = CELL / steps;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps - 0.5;
      const px = along ? wx + t * CELL : wx;
      const pz = along ? wz : wz + t * CELL;
      const y = mid + (along ? sx : sz) * t * CELL;
      b.box('floor_metal', px, y - 0.3, pz, along ? run : CELL, 0.6, along ? CELL : run);
    }
    // Plafond incliné : approximé par des caissons.
    const ch = l.ceilH[c]!;
    for (let i = 0; i < 4; i++) {
      const t = (i + 0.5) / 4 - 0.5;
      const y = mid + (along ? sx : sz) * t * CELL + ch + 0.3;
      b.box('ceiling', along ? wx + t * CELL : wx, y, along ? wz : wz + t * CELL, along ? CELL / 4 : CELL, 0.5, along ? CELL : CELL / 4);
    }
    // Mains courantes.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const t = (i + 0.5) / 2 - 0.5;
        const y = mid + (along ? sx : sz) * t * CELL + 0.95;
        b.box('metal', along ? wx + t * CELL : wx + side * 0.82, y, along ? wz + side * 0.82 : wz + t * CELL, along ? CELL / 2 : 0.04, 0.04, along ? 0.04 : CELL / 2);
      }
    }
  }

  private cellMinY(c: number): number {
    const l = this.layout;
    if (l.kind[c] === CellKind.Elevator && l.elevator) return l.elevator.bottomY;
    return l.floorY[c]! - (Math.abs(l.slopeX[c]!) + Math.abs(l.slopeZ[c]!)) * (CELL / 2);
  }

  private cellMaxY(c: number): number {
    const l = this.layout;
    if (l.kind[c] === CellKind.Elevator && l.elevator) return l.elevator.topY + l.ceilH[c]!;
    return l.floorY[c]! + (Math.abs(l.slopeX[c]!) + Math.abs(l.slopeZ[c]!)) * (CELL / 2) + l.ceilH[c]!;
  }

  /** Murs, plinthes et encadrements autour d'une cellule. */
  private walls(b: GeoBatch, c: number, wallMat: string, accent: string, trim: boolean): void {
    const l = this.layout;
    const cx = c % GRID_W;
    const cy = (c / GRID_W) | 0;
    const mat = l.kind[c] === CellKind.Conduit ? 'conduit' : wallMat;
    for (let d = 0; d < 4; d++) {
      const e = l.edges[c * 4 + d]!;
      if (e === EDGE_OPEN) continue;
      const nx = cx + DIR_DX[d]!;
      const ny = cy + DIR_DY[d]!;
      const n = ny * GRID_W + nx;
      const nVoid = nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H || l.kind[n] === CellKind.Void;
      if (!nVoid && (d === 0 || d === 3)) continue;
      const minY = nVoid ? this.cellMinY(c) : Math.min(this.cellMinY(c), this.cellMinY(n));
      const maxY = nVoid ? this.cellMaxY(c) : Math.max(this.cellMaxY(c), this.cellMaxY(n));
      const horizontal = d === 0 || d === 2;
      // Milieu de l'arête.
      const ex = cx * CELL + (d === 1 ? CELL : d === 3 ? 0 : CELL / 2);
      const ez = cy * CELL + (d === 2 ? CELL : d === 0 ? 0 : CELL / 2);
      const seg = (from: number, to: number, y0: number, y1: number, m: string, thick = WALL_T, faces = 63): void => {
        const len = to - from;
        const mid = (from + to) / 2 - CELL / 2;
        if (horizontal) b.box(m, ex + mid, (y0 + y1) / 2, ez, len, y1 - y0, thick, faces);
        else b.box(m, ex, (y0 + y1) / 2, ez + mid, thick, y1 - y0, len, faces);
      };
      const sideFaces = horizontal ? 12 : 3;
      if (e === EDGE_WALL) {
        b.shade = 1;
        seg(-WALL_T / 2, CELL + WALL_T / 2, minY, maxY, mat, WALL_T, sideFaces);
        if (trim) {
          // Plinthe et lisse colorée : donnent du relief et identifient le secteur.
          const base = l.floorY[c]!;
          seg(0, CELL, base, base + 0.12, 'metal_dark', WALL_T + 0.04, sideFaces | 16);
          seg(0, CELL, base + 1.02, base + 1.1, accent, WALL_T + 0.03, sideFaces | 48);
        }
        continue;
      }
      const door = l.doors[e - EDGE_DOOR_BASE]!;
      const op = OPENING[door.kind];
      const a = (CELL - op.w) / 2;
      const base = this.doorBaseY(door);
      b.shade = 1;
      seg(-WALL_T / 2, a, minY, maxY, mat);
      seg(CELL - a, CELL + WALL_T / 2, minY, maxY, mat);
      seg(a, CELL - a, base + op.h, maxY, mat);
      if (base - minY > 0.05) seg(a, CELL - a, minY, base, mat);
      // Encadrement.
      const frame = door.kind === 'gate' || door.kind === 'elevator' ? 'hazard' : door.kind === 'secret' ? mat : 'metal_dark';
      if (door.kind !== 'secret') {
        seg(a - 0.07, a, base, base + op.h + 0.07, frame, WALL_T + 0.08);
        seg(CELL - a, CELL - a + 0.07, base, base + op.h + 0.07, frame, WALL_T + 0.08);
        seg(a, CELL - a, base + op.h, base + op.h + 0.07, frame, WALL_T + 0.08);
        if (door.kind !== 'vent') seg(a, CELL - a, base - 0.02, base + 0.015, 'metal_dark', WALL_T + 0.1);
      }
    }
  }

  private doorBaseY(door: DoorDef): number {
    const l = this.layout;
    const n = door.cell + DIR_DX[door.dir]! + DIR_DY[door.dir]! * GRID_W;
    if (l.elevator && door.kind === 'elevator') return door.id === l.elevator.doorTop ? l.elevator.topY : l.elevator.bottomY;
    return Math.max(l.kind[door.cell] === CellKind.Elevator ? -99 : l.floorY[door.cell]!, l.kind[n] === CellKind.Elevator ? -99 : l.floorY[n]!);
  }

  private buildDoors(): void {
    for (const def of this.layout.doors) {
      if (def.kind === 'arch') continue;
      const c = doorCenter(def);
      const baseY = this.doorBaseY(def);
      const horizontal = def.dir === 0 || def.dir === 2;
      const node = new TransformNode(`porte:${def.id}`, this.scene);
      const op = OPENING[def.kind];
      node.rotation.y = horizontal ? 0 : Math.PI / 2;
      // Charnière à une extrémité de l'ouverture pour les portes battantes.
      const hinge = def.kind === 'door' ? -op.w / 2 : 0;
      node.position.set(c.x + (horizontal ? hinge : 0), baseY, c.z + (horizontal ? 0 : -hinge));
      const key = def.kind === 'secret' ? `secret:${SECTOR_BY_ID[this.layout.regions[def.a]!.sector].wall}` : def.kind;
      const source = this.leafSources.get(key) ?? this.leafSources.get('door')!;
      const leaf = source.createInstance(`battant:${def.id}`);
      leaf.parent = node;
      leaf.isPickable = false;
      let lamp: InstancedMesh | null = null;
      if (def.kind === 'gate' || def.kind === 'elevator') {
        lamp = this.ledSource.createInstance(`voyant-porte:${def.id}`);
        lamp.scaling.set(2.2, 2.2, 6);
        lamp.position.set(c.x + (horizontal ? op.w / 2 + 0.12 : 0), baseY + 1.5, c.z + (horizontal ? 0 : op.w / 2 + 0.12));
        lamp.rotation.y = horizontal ? 0 : Math.PI / 2;
        lamp.instancedBuffers['color'] = new Color4(0.9, 0.05, 0.05, 1);
      }
      this.doors.push({ def, node, open: 0, lamp, planks: null, baseY, cx: c.x, cz: c.z });
    }
  }

  private buildIndicators(): void {
    const l = this.layout;
    for (const f of l.fixtures) {
      if (f.type === 'camera' || f.type === 'locker') continue;
      const spec = FIXTURE_SPECS[f.type]!;
      const led = this.ledSource.createInstance(`voyant:${f.id}`);
      const front = spec.d / 2 + 0.015;
      led.position.set(f.x + Math.sin(f.rot) * front + Math.cos(f.rot) * (spec.w / 2 - 0.1), f.y + Math.min(spec.h - 0.08, 1.75), f.z + Math.cos(f.rot) * front - Math.sin(f.rot) * (spec.w / 2 - 0.1));
      led.rotation.y = f.rot;
      led.instancedBuffers['color'] = new Color4(0.05, 0.05, 0.05, 1);
      let screen: InstancedMesh | null = null;
      if (f.type === 'terminal') {
        screen = this.screenSource.createInstance(`ecran:${f.id}`);
        screen.position.set(f.x + Math.sin(f.rot) * -0.025, f.y + 1.14, f.z + Math.cos(f.rot) * -0.025);
        screen.rotation.y = f.rot + Math.PI;
        screen.isVisible = false;
      }
      this.leds.push({ id: f.id, mesh: led, screen });
    }
    for (const light of l.lights) {
      const panel = this.panelSource.createInstance(`neon:${light.id}`);
      panel.position.set(light.x, light.y - 0.0, light.z);
      panel.rotation.y = (light.id % 2) * (Math.PI / 2);
      panel.instancedBuffers['color'] = new Color4(0, 0, 0, 1);
      panel.isPickable = false;
      this.lightPanels.push(panel);
    }
  }

  private buildElevator(): void {
    const lift = this.layout.elevator;
    if (!lift) return;
    const b = new GeoBatch();
    const cx = (lift.cell % GRID_W) * CELL + CELL / 2;
    const cz = ((lift.cell / GRID_W) | 0) * CELL + CELL / 2;
    b.box('floor_metal', 0, -0.05, 0, CELL - 0.22, 0.1, CELL - 0.22);
    b.box('painted_grey', 0, 2.5, 0, CELL - 0.22, 0.08, CELL - 0.22);
    for (const [x, z] of [[-0.85, -0.85], [0.85, -0.85], [-0.85, 0.85], [0.85, 0.85]] as const) b.box('metal', x, 1.25, z, 0.06, 2.5, 0.06);
    b.box('hazard', 0, 0.02, 0, CELL - 0.3, 0.02, 0.12);
    const node = new TransformNode('cabine', this.scene);
    node.position.set(cx, lift.topY, cz);
    for (const [mat, mesh] of b.build(this.scene, 'cabine')) {
      mesh.material = this.lib.get(mat);
      mesh.parent = node;
      mesh.isPickable = false;
      mesh.receiveShadows = true;
    }
    this.cab = node;
  }

  /** Panneaux de secteur au-dessus des sas. */
  private buildSigns(): void {
    const l = this.layout;
    for (const door of l.doors) {
      if (door.kind !== 'gate' && door.kind !== 'elevator') continue;
      const c = doorCenter(door);
      const baseY = this.doorBaseY(door);
      const horizontal = door.dir === 0 || door.dir === 2;
      for (const side of [0, 1]) {
        // Chaque face annonce le secteur dans lequel on entre.
        const target = l.regions[side === 0 ? door.b : door.a]!;
        const name = door.kind === 'elevator' ? 'ASCENSEUR — NOYAU' : SECTOR_BY_ID[target.sector].name.toUpperCase();
        const accent = SECTOR_BY_ID[target.sector].accent;
        const tex = new DynamicTexture(`panneau:${door.id}:${side}`, { width: 512, height: 96 }, this.scene, true);
        const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
        ctx.fillStyle = '#0b0c0e';
        ctx.fillRect(0, 0, 512, 96);
        ctx.fillStyle = `rgb(${accent[0] * 255},${accent[1] * 255},${accent[2] * 255})`;
        ctx.fillRect(0, 0, 14, 96);
        ctx.fillRect(498, 0, 14, 96);
        ctx.font = 'bold 40px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(name, 256, 50, 460);
        tex.update();
        this.textures.push(tex);
        const mat = new StandardMaterial(`panneau:${door.id}:${side}`, this.scene);
        mat.disableLighting = true;
        mat.emissiveTexture = tex;
        mat.diffuseColor = Color3.Black();
        mat.specularColor = Color3.Black();
        this.extraMaterials.push(mat);
        const plane = MeshBuilder.CreatePlane(`panneau:${door.id}:${side}`, { width: 1.5, height: 0.28 }, this.scene);
        plane.material = mat;
        plane.isPickable = false;
        // Côté 0 : face visible depuis la région a (on regarde vers b).
        const sign = side === 0 ? -1 : 1;
        const ox = DIR_DX[door.dir]! * sign * (WALL_T / 2 + 0.06);
        const oz = DIR_DY[door.dir]! * sign * (WALL_T / 2 + 0.06);
        plane.position.set(c.x + ox, baseY + OPENING[door.kind].h + 0.3, c.z + oz);
        plane.rotation.y = Math.atan2(-DIR_DX[door.dir]! * sign, -DIR_DY[door.dir]! * sign) + Math.PI;
        void horizontal;
        this.sources.push(plane);
      }
    }
  }

  /* ================================================================ */
  /* Synchronisation avec l'état du monde                              */
  /* ================================================================ */

  update(world: WorldState, dt: number, cam: Vector3): void {
    this.time += dt;
    const t = this.time;

    /* Portes */
    for (const d of this.doors) {
      const rt = world.doors[d.def.id]!;
      const target = rt.pos === DOOR_OPEN ? 1 : rt.pos === DOOR_AJAR ? 0.16 : 0;
      if (d.open !== target) {
        const speed = d.def.kind === 'gate' || d.def.kind === 'elevator' ? 1.1 : 3;
        d.open += Math.sign(target - d.open) * Math.min(Math.abs(target - d.open), speed * dt);
        const op = OPENING[d.def.kind];
        const horizontal = d.def.dir === 0 || d.def.dir === 2;
        switch (d.def.kind) {
          case 'door':
            d.node.rotation.y = (horizontal ? 0 : Math.PI / 2) - d.open * 1.75;
            break;
          case 'gate':
            d.node.position.y = d.baseY + d.open * (op.h - 0.12);
            break;
          case 'vent':
            d.node.position.y = d.baseY - d.open * (op.h - 0.05);
            break;
          default: {
            // Panneau secret et portes d'ascenseur : coulissent dans le mur.
            const slide = d.open * (op.w - 0.04);
            d.node.position.x = d.cx + (horizontal ? slide : 0);
            d.node.position.z = d.cz + (horizontal ? 0 : slide);
            break;
          }
        }
      }
      if (d.lamp) {
        const col = d.lamp.instancedBuffers['color'] as Color4;
        if (rt.locked) col.set(0.95, 0.06, 0.04, 1);
        else col.set(0.1, 0.9, 0.25, 1);
      }
      // Barricade : planches posées du côté d'où elle a été montée.
      if (rt.barricade > 0 && !d.planks) {
        const planks = this.plankSource.createInstance(`planches:${d.def.id}`);
        const inside = rt.barricadeSide === d.def.a ? -1 : 1;
        const horizontal = d.def.dir === 0 || d.def.dir === 2;
        planks.position.set(d.cx + DIR_DX[d.def.dir]! * inside * 0.16, d.baseY, d.cz + DIR_DY[d.def.dir]! * inside * 0.16);
        planks.rotation.y = horizontal ? 0 : Math.PI / 2;
        d.planks = planks;
      } else if (rt.barricade <= 0 && d.planks) {
        d.planks.dispose();
        d.planks = null;
      }
    }

    /* Voyants des machines */
    const blink = Math.sin(t * 6) > 0;
    for (const led of this.leds) {
      const f = world.fixtures.get(led.id);
      const def = world.fixtureDefs.get(led.id);
      if (!f || !def) continue;
      const powered = world.sectorPowered(def.sector) || def.type === 'fusebox' || def.type.startsWith('generator');
      const col = led.mesh.instancedBuffers['color'] as Color4;
      if (f.broken) col.set(blink ? 1 : 0.15, 0.03, 0.02, 1);
      else if (f.t > 0) col.set(blink ? 1 : 0.3, blink ? 0.6 : 0.2, 0.02, 1);
      else if (!powered) col.set(0.03, 0.03, 0.03, 1);
      else if (def.type === 'fusebox' ? f.value >= f.need : f.on) col.set(0.1, 0.95, 0.3, 1);
      else col.set(0.7, 0.45, 0.05, 1);
      if (led.screen) led.screen.isVisible = world.sectorPowered(def.sector);
    }

    /* Objets au sol */
    if (this.items.size !== world.items.size || this.cullTimer <= 0) {
      for (const [uid, mesh] of this.items) {
        if (!world.items.has(uid)) {
          mesh.dispose();
          this.items.delete(uid);
        }
      }
      for (const it of world.items.values()) {
        if (this.items.has(it.uid)) continue;
        const source = this.itemSources.get(it.item) ?? this.itemSources.get('document')!;
        const mesh = source.createInstance(`objet:${it.uid}`);
        mesh.position.set(it.x, it.y, it.z);
        mesh.rotation.y = (it.uid * 2.39996) % (Math.PI * 2);
        mesh.isPickable = false;
        this.items.set(it.uid, mesh);
      }
    }

    /* Marqueurs lumineux et caméras posées */
    if (this.markers.size !== world.markers.length) {
      const alive = new Set(world.markers.map((m) => m.id));
      for (const [id, mesh] of this.markers) {
        if (!alive.has(id)) {
          mesh.dispose();
          this.markers.delete(id);
        }
      }
      for (const m of world.markers) {
        if (this.markers.has(m.id)) continue;
        const mesh = this.markerSource.createInstance(`marqueur:${m.id}`);
        mesh.position.set(m.x, m.y + 0.015, m.z);
        mesh.rotation.y = (m.id * 1.7) % Math.PI;
        mesh.instancedBuffers['color'] = new Color4(0.25, 1, 0.4, 1);
        this.markers.set(m.id, mesh);
      }
    }
    if (this.cameras.size !== world.cameras.length) {
      const alive = new Set(world.cameras.map((c) => c.id));
      for (const [id, mesh] of this.cameras) {
        if (!alive.has(id)) {
          mesh.dispose();
          this.cameras.delete(id);
        }
      }
      for (const c of world.cameras) {
        if (this.cameras.has(c.id)) continue;
        const mesh = this.cameraSource.createInstance(`camera:${c.id}`);
        mesh.position.set(c.x, c.y - 0.35, c.z);
        mesh.rotation.y = c.yaw;
        this.cameras.set(c.id, mesh);
      }
    }

    if (this.cab) this.cab.position.y = world.elevator.y;

    // Le Noyau pulse tant qu'il n'est pas désaccordé.
    const detuned = world.flag('detuned') > 0;
    const pulse = detuned ? 0.04 : 0.45 + Math.sin(t * 1.7) * 0.25 + Math.sin(t * 7.3) * 0.05;
    this.coreMaterial.emissiveColor.set(pulse, pulse * 0.06, pulse * 0.08);

    /* Occlusion par distance : les secteurs lointains ne sont pas dessinés. */
    this.cullTimer -= dt;
    if (this.cullTimer <= 0) {
      this.cullTimer = 0.4;
      for (let s = 0; s < SECTORS.length; s++) {
        const inst = this.layout.sectors.find((x) => x.id === SECTORS[s]!.id)!;
        const half = (SLOT * CELL) / 2;
        const dx = Math.max(0, Math.abs(cam.x - (inst.mx * SLOT * CELL + half)) - half);
        const dz = Math.max(0, Math.abs(cam.z - (inst.my * SLOT * CELL + half)) - half);
        const visible = dx * dx + dz * dz < 55 * 55;
        for (const mesh of this.sectorMeshes[s]!) mesh.setEnabled(visible);
      }
    }
  }

  /** Instance d'un objet (pour l'objet tenu en main). */
  createItemInstance(id: string): InstancedMesh {
    const source = this.itemSources.get(id) ?? this.itemSources.get('document')!;
    const mesh = source.createInstance(`tenu:${id}`);
    mesh.isPickable = false;
    return mesh;
  }

  /** Couleur de chaque néon (appelé par l'éclairage, qui connaît l'état des lumières). */
  setPanelColor(index: number, r: number, g: number, b: number): void {
    (this.lightPanels[index]!.instancedBuffers['color'] as Color4).set(r, g, b, 1);
  }

  dispose(): void {
    for (const meshes of this.sectorMeshes) for (const m of meshes) m.dispose();
    for (const d of this.doors) d.node.dispose(false, false);
    for (const m of this.items.values()) m.dispose();
    for (const m of this.markers.values()) m.dispose();
    for (const m of this.cameras.values()) m.dispose();
    for (const p of this.lightPanels) p.dispose();
    for (const l of this.leds) {
      l.mesh.dispose();
      l.screen?.dispose();
    }
    for (const s of this.sources) s.dispose();
    for (const t of this.textures) t.dispose();
    for (const m of this.extraMaterials) m.dispose();
    this.cab?.dispose(false, false);
  }
}
