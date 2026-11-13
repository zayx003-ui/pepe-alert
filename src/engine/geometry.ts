/**
 * Construction de géométrie par lots : toutes les boîtes, cylindres et quads
 * d'un même matériau finissent dans un seul maillage (un seul appel de dessin).
 * Les coordonnées de texture sont exprimées en mètres pour que les matériaux
 * se raccordent d'un mur à l'autre.
 */
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';

interface Buffers {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  indices: number[];
}

/** Faces d'une boîte : normale, tangente U et bitangente V (U × V = N). */
const FACES: readonly [number, number, number, number, number, number, number, number, number][] = [
  [1, 0, 0, 0, 0, -1, 0, 1, 0],
  [-1, 0, 0, 0, 0, 1, 0, 1, 0],
  [0, 0, 1, 1, 0, 0, 0, 1, 0],
  [0, 0, -1, -1, 0, 0, 0, 1, 0],
  [0, 1, 0, 1, 0, 0, 0, 0, -1],
  [0, -1, 0, 1, 0, 0, 0, 0, 1],
];

export class GeoBatch {
  private buffers = new Map<string, Buffers>();
  // Transformation courante : rotation 3x3 puis translation.
  private m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  private tx = 0;
  private ty = 0;
  private tz = 0;
  private aligned = true;
  /** Assombrissement appliqué aux prochains sommets (0 à 1). */
  shade = 1;

  private get(mat: string): Buffers {
    let b = this.buffers.get(mat);
    if (!b) {
      b = { positions: [], normals: [], uvs: [], colors: [], indices: [] };
      this.buffers.set(mat, b);
    }
    return b;
  }

  /** Place le repère local : position, lacet, puis inclinaisons (objets renversés). */
  setTransform(x: number, y: number, z: number, rotY = 0, tiltX = 0, tiltZ = 0): void {
    this.tx = x;
    this.ty = y;
    this.tz = z;
    const cy = Math.cos(rotY);
    const sy = Math.sin(rotY);
    const cx = Math.cos(tiltX);
    const sx = Math.sin(tiltX);
    const cz = Math.cos(tiltZ);
    const sz = Math.sin(tiltZ);
    // M = Ry * Rx * Rz
    const r00 = cz;
    const r01 = -sz;
    const r10 = cx * sz;
    const r11 = cx * cz;
    const r12 = -sx;
    const r20 = sx * sz;
    const r21 = sx * cz;
    const r22 = cx;
    this.m[0] = cy * r00 + sy * r20;
    this.m[1] = cy * r01 + sy * r21;
    this.m[2] = sy * r22;
    this.m[3] = r10;
    this.m[4] = r11;
    this.m[5] = r12;
    this.m[6] = -sy * r00 + cy * r20;
    this.m[7] = -sy * r01 + cy * r21;
    this.m[8] = cy * r22;
    this.aligned = rotY === 0 && tiltX === 0 && tiltZ === 0;
  }

  resetTransform(): void {
    this.setTransform(0, 0, 0);
  }

  private vertex(b: Buffers, x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): void {
    const m = this.m;
    b.positions.push(m[0]! * x + m[1]! * y + m[2]! * z + this.tx, m[3]! * x + m[4]! * y + m[5]! * z + this.ty, m[6]! * x + m[7]! * y + m[8]! * z + this.tz);
    b.normals.push(m[0]! * nx + m[1]! * ny + m[2]! * nz, m[3]! * nx + m[4]! * ny + m[5]! * nz, m[6]! * nx + m[7]! * ny + m[8]! * nz);
    b.uvs.push(u, v);
    b.colors.push(this.shade, this.shade, this.shade, 1);
  }

  private quadIndices(b: Buffers, base: number): void {
    b.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  /**
   * Boîte centrée en (cx, cy, cz) dans le repère local.
   * `faces` : masque binaire des faces à produire (+X, -X, +Z, -Z, +Y, -Y) ; 63 = toutes.
   */
  box(mat: string, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, faces = 63): void {
    const b = this.get(mat);
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    // Décalage des UV : en repère aligné, on suit les coordonnées monde pour raccorder les surfaces.
    const ox = this.aligned ? this.tx : 0;
    const oy = this.aligned ? this.ty : 0;
    const oz = this.aligned ? this.tz : 0;
    for (let f = 0; f < 6; f++) {
      if (!(faces & (1 << f))) continue;
      const [nx, ny, nz, ux, uy, uz, vx, vy, vz] = FACES[f]!;
      const base = b.positions.length / 3;
      for (let k = 0; k < 4; k++) {
        const su = k === 0 || k === 3 ? -1 : 1;
        const sv = k < 2 ? -1 : 1;
        const x = cx + nx * hx + ux * su * hx + vx * sv * hx;
        const y = cy + ny * hy + uy * su * hy + vy * sv * hy;
        const z = cz + nz * hz + uz * su * hz + vz * sv * hz;
        const u = ux * (x + ox) + uy * (y + oy) + uz * (z + oz);
        const v = vx * (x + ox) + vy * (y + oy) + vz * (z + oz);
        this.vertex(b, x, y, z, nx, ny, nz, u, v);
      }
      this.quadIndices(b, base);
    }
  }

  /** Quadrilatère quelconque (sommets dans le sens direct vu depuis la normale). */
  quad(mat: string, p: readonly number[], n: readonly [number, number, number], uv: readonly number[]): void {
    const b = this.get(mat);
    const base = b.positions.length / 3;
    for (let k = 0; k < 4; k++) this.vertex(b, p[k * 3]!, p[k * 3 + 1]!, p[k * 3 + 2]!, n[0], n[1], n[2], uv[k * 2]!, uv[k * 2 + 1]!);
    this.quadIndices(b, base);
  }

  /** Quad horizontal posé au sol (décalques), UV de 0 à 1. */
  decal(mat: string, w: number, d: number): void {
    const hw = w / 2;
    const hd = d / 2;
    this.quad(mat, [-hw, 0, hd, hw, 0, hd, hw, 0, -hd, -hw, 0, -hd], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1]);
  }

  /** Cylindre d'axe Y (ou X / Z), centré. */
  cylinder(mat: string, cx: number, cy: number, cz: number, radius: number, height: number, axis: 'x' | 'y' | 'z' = 'y', segments = 10): void {
    const b = this.get(mat);
    const h = height / 2;
    const map = (a: number, r: number, t: number): [number, number, number] => {
      const c = Math.cos(a) * r;
      const s = Math.sin(a) * r;
      if (axis === 'y') return [cx + c, cy + t, cz + s];
      if (axis === 'x') return [cx + t, cy + c, cz + s];
      return [cx + c, cy + s, cz + t];
    };
    const nrm = (a: number): [number, number, number] => {
      const c = Math.cos(a);
      const s = Math.sin(a);
      if (axis === 'y') return [c, 0, s];
      if (axis === 'x') return [0, c, s];
      return [c, s, 0];
    };
    const circumference = Math.PI * 2 * radius;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const base = b.positions.length / 3;
      const n0 = nrm(a0);
      const n1 = nrm(a1);
      const u0 = (i / segments) * circumference;
      const u1 = ((i + 1) / segments) * circumference;
      // L'ordre des sommets dépend de l'axe pour garder la face tournée vers l'extérieur.
      const flip = axis === 'y';
      const A = map(flip ? a1 : a0, radius, -h);
      const B = map(flip ? a0 : a1, radius, -h);
      const C = map(flip ? a0 : a1, radius, h);
      const D = map(flip ? a1 : a0, radius, h);
      const nA = flip ? n1 : n0;
      const nB = flip ? n0 : n1;
      this.vertex(b, A[0], A[1], A[2], nA[0], nA[1], nA[2], flip ? u1 : u0, 0);
      this.vertex(b, B[0], B[1], B[2], nB[0], nB[1], nB[2], flip ? u0 : u1, 0);
      this.vertex(b, C[0], C[1], C[2], nB[0], nB[1], nB[2], flip ? u0 : u1, height);
      this.vertex(b, D[0], D[1], D[2], nA[0], nA[1], nA[2], flip ? u1 : u0, height);
      this.quadIndices(b, base);
    }
    // Couvercles.
    for (const side of [-1, 1]) {
      const base = b.positions.length / 3;
      const n: [number, number, number] = axis === 'y' ? [0, side, 0] : axis === 'x' ? [side, 0, 0] : [0, 0, side];
      const c = map(0, 0, side * h);
      this.vertex(b, c[0], c[1], c[2], n[0], n[1], n[2], 0.5, 0.5);
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const p = map(a, radius, side * h);
        this.vertex(b, p[0], p[1], p[2], n[0], n[1], n[2], 0.5 + Math.cos(a) * radius, 0.5 + Math.sin(a) * radius);
      }
      for (let i = 0; i < segments; i++) {
        const outward = (axis === 'y' ? side > 0 : side < 0) ? [base, base + i + 2, base + i + 1] : [base, base + i + 1, base + i + 2];
        b.indices.push(outward[0]!, outward[1]!, outward[2]!);
      }
    }
  }

  get materials(): string[] {
    return Array.from(this.buffers.keys());
  }

  isEmpty(): boolean {
    return this.buffers.size === 0;
  }

  /** Produit un maillage par matériau. */
  build(scene: Scene, prefix: string): Map<string, Mesh> {
    const out = new Map<string, Mesh>();
    for (const [mat, b] of this.buffers) {
      if (b.indices.length === 0) continue;
      const mesh = new Mesh(`${prefix}:${mat}`, scene);
      const data = new VertexData();
      data.positions = b.positions;
      data.normals = b.normals;
      data.uvs = b.uvs;
      data.colors = b.colors;
      data.indices = b.indices;
      data.applyToMesh(mesh);
      out.set(mat, mesh);
    }
    this.buffers.clear();
    return out;
  }
}
