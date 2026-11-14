/**
 * Vue de jeu : relie une GameSession à la scène 3D.
 * Caméra à la première personne (oscillation, inclinaison, souffle, impacts),
 * décor, éclairage, avatars, particules et altérations de perception.
 */
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import '@babylonjs/core/Particles/particleSystemComponent';
import type { Settings } from '../config/settings';
import { clamp, damp } from '../core/math';
import type { GameSession } from '../game/session';
import { FLAG_ALIVE, FLAG_CROUCH, FLAG_LIGHT } from '../network/protocol';
import { EntityAvatar, PlayerAvatar } from './avatars';
import { LightRig } from './lighting';
import { MaterialLibrary } from './materials';
import type { Renderer } from './renderer';
import { WorldView } from './worldView';

export interface ExternalView {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

interface Mirage {
  avatar: PlayerAvatar;
  x: number;
  y: number;
  z: number;
  yaw: number;
  ttl: number;
}

export class GameView {
  readonly camera: FreeCamera;
  readonly world: WorldView;
  readonly lights: LightRig;
  /** Vue d'une caméra de surveillance (remplace la vue du joueur). */
  external: ExternalView | null = null;
  /** Joueur suivi en mode spectateur. */
  spectating = '';
  /** Direction du regard et position de l'œil (pour l'audio spatial). */
  readonly eye = new Vector3();
  readonly forward = new Vector3(0, 0, 1);
  private lib: MaterialLibrary;
  private players = new Map<string, PlayerAvatar>();
  private entities = new Map<number, EntityAvatar>();
  private mirages: Mirage[] = [];
  private dust: ParticleSystem | null = null;
  private steam: ParticleSystem | null = null;
  private particleTexture: DynamicTexture | null = null;
  private held: InstancedMesh | null = null;
  private heldId = '';
  private shadowTimer = 0;
  private time = 0;
  // Ressorts de la caméra.
  private bobX = 0;
  private bobY = 0;
  private roll = 0;
  private dip = 0;
  private dipVel = 0;
  private kickPitch = 0;
  private kickRoll = 0;
  private trauma = 0;
  private lastHealth = 100;
  private offUnsubs: (() => void)[] = [];

  constructor(
    private renderer: Renderer,
    private session: GameSession,
    private settings: Settings,
  ) {
    const scene = renderer.scene;
    const profile = renderer.profile;
    this.lib = new MaterialLibrary(scene, profile.textureSize, 2 + profile.light.pool + profile.light.remote);
    this.world = new WorldView(scene, this.lib, session.layout);
    this.lights = new LightRig(scene, session.layout, this.world, profile.light);

    this.camera = new FreeCamera('joueur', new Vector3(0, 1.6, 0), scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.06;
    this.camera.maxZ = 90;
    this.camera.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
    this.camera.fov = (settings.fov * Math.PI) / 180;
    scene.activeCamera = this.camera;
    renderer.attachPipeline(this.camera);

    if (profile.particles > 0) this.buildParticles(profile.particles);

    for (const p of session.players.values()) {
      if (p.id === session.self.id) continue;
      this.players.set(p.id, new PlayerAvatar(scene, this.lib, p.name, p.color));
    }

    this.offUnsubs.push(
      session.events.on('fx', (fx) => {
        if (fx.type === 'fake' && fx.what === 'mirage') this.spawnMirage(fx.x, fx.z, fx.as);
      }),
      session.events.on('hurt', ({ amount }) => this.kick(amount)),
    );
  }

  private buildParticles(count: number): void {
    const scene = this.renderer.scene;
    const tex = new DynamicTexture('grain', { width: 32, height: 32 }, scene, false);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    tex.update();
    tex.hasAlpha = true;
    this.particleTexture = tex;

    // Poussière en suspension, révélée par le faisceau de la lampe.
    const dust = new ParticleSystem('poussiere', count, scene);
    dust.particleTexture = tex;
    dust.emitter = new Vector3();
    dust.minEmitBox = new Vector3(-2.2, -0.9, -2.2);
    dust.maxEmitBox = new Vector3(2.2, 0.9, 2.2);
    dust.minSize = 0.008;
    dust.maxSize = 0.03;
    dust.minLifeTime = 3;
    dust.maxLifeTime = 7;
    dust.emitRate = count / 5;
    dust.direction1 = new Vector3(-0.05, -0.02, -0.05);
    dust.direction2 = new Vector3(0.05, 0.05, 0.05);
    dust.minEmitPower = 0.02;
    dust.maxEmitPower = 0.1;
    dust.gravity = new Vector3(0, -0.01, 0);
    dust.blendMode = ParticleSystem.BLENDMODE_ADD;
    dust.color1 = new Color4(1, 0.95, 0.85, 0.5);
    dust.color2 = new Color4(0.9, 0.9, 1, 0.3);
    dust.colorDead = new Color4(0, 0, 0, 0);
    dust.start();
    this.dust = dust;

    const steam = new ParticleSystem('vapeur', 80, scene);
    steam.particleTexture = tex;
    steam.emitter = new Vector3(0, -100, 0);
    steam.minSize = 0.25;
    steam.maxSize = 0.9;
    steam.minLifeTime = 0.6;
    steam.maxLifeTime = 1.6;
    steam.emitRate = 0;
    steam.direction1 = new Vector3(-0.6, 0.4, 0.6);
    steam.direction2 = new Vector3(0.6, 1.2, 1.6);
    steam.minEmitPower = 1;
    steam.maxEmitPower = 2.6;
    steam.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    steam.color1 = new Color4(0.75, 0.78, 0.8, 0.22);
    steam.color2 = new Color4(0.6, 0.62, 0.65, 0.12);
    steam.colorDead = new Color4(0.5, 0.5, 0.5, 0);
    steam.start();
    this.steam = steam;
  }

  /** Secousse en réaction à un impact. */
  kick(amount: number): void {
    const k = clamp(amount / 40, 0.15, 1);
    this.kickPitch -= 0.09 * k;
    this.kickRoll += (Math.random() < 0.5 ? -1 : 1) * 0.07 * k;
    this.trauma = Math.min(1, this.trauma + k * 0.7);
  }

  private spawnMirage(x: number, z: number, as: string): void {
    const who = this.session.players.get(as);
    if (!who || this.mirages.length >= 2) return;
    const avatar = new PlayerAvatar(this.renderer.scene, this.lib, '', who.color);
    const m = this.session.motor;
    this.mirages.push({ avatar, x, y: this.session.world.grid.heightAt(x, z), z, yaw: Math.atan2(m.x - x, m.z - z), ttl: 14 });
  }

  /** Change de coéquipier observé (mode spectateur). */
  cycleSpectator(): void {
    const alive = Array.from(this.session.players.values()).filter((p) => p.id !== this.session.self.id && p.status === 'playing' && p.connected);
    if (alive.length === 0) {
      this.spectating = '';
      return;
    }
    const i = alive.findIndex((p) => p.id === this.spectating);
    this.spectating = alive[(i + 1) % alive.length]!.id;
  }

  update(dt: number): void {
    const s = this.session;
    const m = s.motor;
    const sim = s.sim;
    this.time += dt;
    const t = this.time;
    const cam = this.camera;
    const comfort = this.settings.bob;
    const per = sim.perception();

    /* ---------------- caméra ---------------- */
    let yaw = m.yaw;
    let pitch = m.pitch;
    const playing = s.status === 'playing' && sim.alive;
    if (this.external) {
      cam.position.set(this.external.x, this.external.y, this.external.z);
      yaw = this.external.yaw + Math.sin(t * 0.35) * 0.5;
      pitch = this.external.pitch;
      cam.rotation.set(pitch, yaw, 0);
    } else if (!playing) {
      // Spectateur : derrière un coéquipier vivant, sinon vue plongeante sur le dernier emplacement.
      let target = this.spectating ? s.players.get(this.spectating) : undefined;
      if (!target || target.status !== 'playing') {
        this.cycleSpectator();
        target = this.spectating ? s.players.get(this.spectating) : undefined;
      }
      if (target) {
        yaw = target.yaw;
        pitch = 0.25;
        const bx = target.x - Math.sin(yaw) * 1.6;
        const bz = target.z - Math.cos(yaw) * 1.6;
        const ok = s.world.grid.sight(target.x, target.z, bx, bz);
        cam.position.set(ok ? bx : target.x, target.y + 1.9, ok ? bz : target.z);
      } else {
        cam.position.set(m.x, m.y + 2.4, m.z);
        pitch = 1.2;
        yaw = m.yaw + t * 0.05;
      }
      cam.rotation.set(pitch, yaw, 0);
    } else {
      // Oscillation de la démarche.
      const moving = m.grounded && m.speed > 0.4;
      const amp = (moving ? (m.sprinting ? 0.055 : m.crouching ? 0.018 : 0.032) : 0) * comfort;
      this.bobY = damp(this.bobY, Math.abs(Math.sin(m.gait)) * amp, 14, dt);
      this.bobX = damp(this.bobX, Math.cos(m.gait) * amp * 0.5, 14, dt);
      // Inclinaison dans les pas de côté.
      const side = m.vx * Math.cos(m.yaw) - m.vz * Math.sin(m.yaw);
      this.roll = damp(this.roll, -side * 0.012 * comfort, 8, dt);
      // Amorti de l'atterrissage.
      if (m.events.landed > 2) this.dipVel -= Math.min(2.2, m.events.landed * 0.22) * comfort;
      this.dipVel += (-this.dip * 140 - this.dipVel * 16) * dt;
      this.dip += this.dipVel * dt;
      // Souffle : ample quand on est essoufflé.
      const winded = clamp((45 - sim.stamina) / 45, 0, 1);
      const breath = Math.sin(t * (1.6 + winded * 3.2)) * (0.003 + winded * 0.012) * (0.4 + comfort * 0.6);
      // Tremblement (froid, stress) et secousses d'impact.
      const shake = this.settings.shake ? 1 : 0.25;
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
      const tremor = per.tremor * 0.004 + this.trauma * this.trauma * 0.03 * shake;
      this.kickPitch = damp(this.kickPitch, 0, 7, dt);
      this.kickRoll = damp(this.kickRoll, 0, 6, dt);
      const limp = sim.has('fracture') && moving ? Math.sin(m.gait) * 0.025 * comfort : 0;

      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      cam.position.set(m.x + rx * this.bobX, m.y + m.eyeHeight + this.bobY + this.dip + breath, m.z + rz * this.bobX);
      cam.rotation.set(
        pitch + this.kickPitch * shake + Math.sin(t * 37) * tremor + breath * 0.6,
        yaw + Math.sin(t * 29) * tremor,
        this.roll + this.kickRoll * shake + limp + Math.sin(t * 23) * tremor,
      );
      if (s.hiddenIn) {
        // Dans un casier : vue à travers les fentes, légèrement abaissée.
        const def = s.world.fixtureDefs.get(s.hiddenIn);
        if (def) cam.position.set(def.x, def.y + 1.5, def.z);
      }
    }
    cam.fov = (this.settings.fov * Math.PI) / 180 * (m.sprinting && playing ? 1.04 : 1);
    const cp = Math.cos(cam.rotation.x);
    this.forward.set(Math.sin(cam.rotation.y) * cp, -Math.sin(cam.rotation.x), Math.cos(cam.rotation.y) * cp);
    this.eye.copyFrom(cam.position);

    /* ---------------- monde et lumière ---------------- */
    this.world.update(s.world, dt, cam.position);
    const lamp = s.inventory.find('lampe');
    const lampOn = playing && !this.external && lamp?.on === true && !s.hiddenIn;
    this.lights.update(s, dt, this.eye, this.forward, lamp?.charge ?? 0, lampOn, per.tremor);

    this.shadowTimer -= dt;
    if (this.shadowTimer <= 0 && this.lights.shadow) {
      this.shadowTimer = 1;
      const casters: Mesh[] = [];
      for (const meshes of this.world.sectorMeshes) {
        for (const mesh of meshes) if (mesh.isEnabled() && this.world.shadowCasters.includes(mesh)) casters.push(mesh);
      }
      for (const a of this.players.values()) casters.push(...a.meshes);
      for (const a of this.entities.values()) casters.push(...a.meshes);
      this.lights.setShadowCasters(casters);
    }

    /* ---------------- avatars ---------------- */
    for (const p of s.players.values()) {
      if (p.id === s.self.id) continue;
      const avatar = this.players.get(p.id);
      if (!avatar) continue;
      const alive = (p.flags & FLAG_ALIVE) !== 0 && p.status !== 'dead';
      const visible = p.status !== 'extracted' && !p.hiddenIn && (p.connected || !alive);
      const dx = p.x - cam.position.x;
      const dz = p.z - cam.position.z;
      avatar.update(dt, p.x, p.y, p.z, p.yaw, p.speed, (p.flags & FLAG_CROUCH) !== 0, (p.flags & FLAG_LIGHT) !== 0, alive, visible, dx * dx + dz * dz < 14 * 14);
    }
    const meter = s.inventory.find('mesureur')?.on === true ? 1 : 0;
    for (const e of s.entities.values()) {
      let avatar = this.entities.get(e.uid);
      if (!avatar) {
        avatar = new EntityAvatar(this.renderer.scene, this.lib, e.kind);
        this.entities.set(e.uid, avatar);
      }
      avatar.update(dt, e.x, e.y, e.z, e.yaw, e.anim, e.visible, meter);
    }
    for (const [uid, avatar] of this.entities) {
      if (!s.entities.has(uid)) {
        avatar.dispose();
        this.entities.delete(uid);
      }
    }
    for (let i = this.mirages.length - 1; i >= 0; i--) {
      const mi = this.mirages[i]!;
      mi.ttl -= dt;
      const near = Math.hypot(mi.x - m.x, mi.z - m.z) < 7;
      if (mi.ttl <= 0 || near) {
        // S'évanouit dès qu'on s'en approche.
        mi.avatar.dispose();
        this.mirages.splice(i, 1);
        if (near) s.sim.addStress(9);
        continue;
      }
      mi.avatar.update(dt, mi.x, mi.y, mi.z, mi.yaw, 0, false, false, true, true, false);
    }

    /* ---------------- objet tenu ---------------- */
    const activeId = playing && !this.external && !s.hiddenIn ? (s.inventory.active?.id ?? '') : '';
    if (activeId !== this.heldId) {
      this.held?.dispose();
      this.held = activeId ? this.world.createItemInstance(activeId) : null;
      this.heldId = activeId;
      if (this.held) {
        this.held.parent = cam;
        this.held.rotation.set(0.1, -Math.PI / 2 + 0.25, 0);
        this.held.scaling.setAll(1.15);
      }
    }
    if (this.held) {
      const use = s.useProgress;
      this.held.position.set(0.24 + this.bobX * 0.6, -0.23 - this.bobY * 0.7 + use * 0.08, 0.42 - use * 0.1);
    }

    /* ---------------- particules ---------------- */
    if (this.dust) {
      (this.dust.emitter as Vector3).set(cam.position.x + this.forward.x * 2.4, cam.position.y + this.forward.y * 2.4, cam.position.z + this.forward.z * 2.4);
      this.dust.emitRate = lampOn ? this.dust.getCapacity() / 5 : 0;
    }
    if (this.steam) {
      // Fuite de vapeur la plus proche.
      let best = 30 * 30;
      let found = false;
      for (const [id, f] of s.world.fixtures) {
        if (!f.broken || !f.on || !id.startsWith('valve.')) continue;
        const def = s.world.fixtureDefs.get(id)!;
        const d = (def.x - m.x) ** 2 + (def.z - m.z) ** 2;
        if (d < best) {
          best = d;
          found = true;
          (this.steam.emitter as Vector3).set(def.x, def.y + 1.1, def.z);
          this.steam.direction1.set(Math.sin(def.rot) * 1.6 - 0.5, 0.2, Math.cos(def.rot) * 1.6 - 0.5);
          this.steam.direction2.set(Math.sin(def.rot) * 1.6 + 0.5, 1.1, Math.cos(def.rot) * 1.6 + 0.5);
        }
      }
      this.steam.emitRate = found ? 45 : 0;
    }

    /* ---------------- perception ---------------- */
    if (sim.health < this.lastHealth - 0.5) this.trauma = Math.min(1, this.trauma + 0.2);
    this.lastHealth = sim.health;
    const cctv = this.external ? 1 : 0;
    this.renderer.setPerception(playing ? per.vignette : 0.5, playing ? per.aberration : cctv * 0.3, playing ? per.desaturate : 0.6, playing ? per.blur : 0);
  }

  dispose(): void {
    for (const off of this.offUnsubs) off();
    this.held?.dispose();
    for (const a of this.players.values()) a.dispose();
    for (const a of this.entities.values()) a.dispose();
    for (const m of this.mirages) m.avatar.dispose();
    this.dust?.dispose();
    this.steam?.dispose();
    this.particleTexture?.dispose();
    this.lights.dispose();
    this.world.dispose();
    this.lib.dispose();
    this.camera.dispose();
  }
}
