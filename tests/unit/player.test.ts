import { describe, expect, it } from 'vitest';
import { Inventory, INVENTORY_SLOTS } from '../../src/inventory/inventory';
import { CROUCH_HEIGHT, PlayerMotor, SPRINT_SPEED, STAND_HEIGHT, WALK_SPEED, movementNoise } from '../../src/player/motor';
import { PlayerSimulation, type SimInput } from '../../src/player/simulation';
import { generateLayout } from '../../src/world/generator';
import { WorldGrid } from '../../src/world/grid';
import { CELL, CellKind, DIR_DX, DIR_DY, EDGE_WALL, GRID_W, cellCenterX, cellCenterZ } from '../../src/world/types';

const layout = generateLayout('JOUEUR');
const grid = new WorldGrid(layout);
const mods = { speedFactor: 1, canSprint: true, canJump: true, frozen: false };
const still = { forward: 0, strafe: 0, sprint: false, crouch: false, jump: false };
const calm: SimInput = {
  moving: false,
  sprinting: false,
  crouching: false,
  encumbrance: 0,
  ambientTemp: 18,
  contamination: 0,
  isolated: false,
  chased: false,
  seesEntity: false,
  inDark: false,
  holdingBreath: false,
  dread: 0,
};

/** Cellule de couloir avec un mur au nord et de la place au sud. */
function wallCell(): number {
  for (const r of layout.regions) {
    if (r.kind !== 'room' || r.w < 3 || r.h < 3) continue;
    for (const c of r.cells) {
      const south = c + GRID_W;
      if (layout.edges[c * 4] === EDGE_WALL && layout.region[south] === r.id && !layout.blocked[c] && !layout.blocked[south]) {
        const hasProp = layout.props.some((p) => Math.abs(p.x - cellCenterX(c)) < 1.2 && Math.abs(p.z - cellCenterZ(c)) < 2.4);
        const hasFixture = layout.fixtures.some((p) => Math.abs(p.x - cellCenterX(c)) < 1.2 && Math.abs(p.z - cellCenterZ(c)) < 2.4);
        if (!hasProp && !hasFixture) return c;
      }
    }
  }
  throw new Error('aucune cellule adaptée');
}

describe('déplacements', () => {
  it('marche à la vitesse prévue et court plus vite', () => {
    const c = wallCell();
    const m = new PlayerMotor();
    m.teleport(cellCenterX(c), layout.floorY[c]!, cellCenterZ(c) + 0.5, 0);
    // yaw = PI : vers le sud (z+ est « devant » à yaw 0, donc on se retourne).
    m.yaw = 0;
    for (let i = 0; i < 20; i++) m.update(0.02, { ...still, forward: -1 }, mods, grid);
    expect(m.speed).toBeGreaterThan(WALK_SPEED * 0.7);
    expect(m.speed).toBeLessThanOrEqual(WALK_SPEED + 0.01);
    const run = new PlayerMotor();
    run.teleport(cellCenterX(c), layout.floorY[c]!, cellCenterZ(c), Math.PI);
    for (let i = 0; i < 12; i++) run.update(0.02, { ...still, forward: 1, sprint: true }, mods, grid);
    expect(run.sprinting).toBe(true);
    expect(run.speed).toBeGreaterThan(WALK_SPEED);
    expect(run.speed).toBeLessThanOrEqual(SPRINT_SPEED + 0.01);
  });

  it('ne traverse pas les murs, même en courant', () => {
    const c = wallCell();
    const m = new PlayerMotor();
    m.teleport(cellCenterX(c), layout.floorY[c]!, cellCenterZ(c), Math.PI); // face au nord (z-)
    for (let i = 0; i < 200; i++) m.update(0.016, { ...still, forward: 1, sprint: true }, mods, grid);
    const wallZ = ((c / GRID_W) | 0) * CELL;
    expect(m.z).toBeGreaterThan(wallZ + 0.3);
    expect(grid.cellAt(m.x, m.z)).toBe(c);
  });

  it("s'accroupit, réduit sa hauteur et son bruit", () => {
    const c = wallCell();
    const m = new PlayerMotor();
    m.teleport(cellCenterX(c), layout.floorY[c]!, cellCenterZ(c), 0);
    expect(m.height).toBeCloseTo(STAND_HEIGHT);
    for (let i = 0; i < 30; i++) m.update(0.02, { ...still, crouch: true, forward: 1 }, mods, grid);
    expect(m.height).toBeCloseTo(CROUCH_HEIGHT);
    const crouchNoise = movementNoise(m, 1);
    const walker = new PlayerMotor();
    walker.teleport(cellCenterX(c), layout.floorY[c]!, cellCenterZ(c), 0);
    for (let i = 0; i < 10; i++) walker.update(0.02, { ...still, forward: 1 }, mods, grid);
    expect(crouchNoise).toBeGreaterThan(0);
    expect(crouchNoise).toBeLessThan(movementNoise(walker, 1) / 2);
  });

  it('saute puis retombe au sol', () => {
    const c = wallCell();
    const m = new PlayerMotor();
    m.teleport(cellCenterX(c), layout.floorY[c]!, cellCenterZ(c), 0);
    m.update(0.016, { ...still, jump: true }, mods, grid);
    expect(m.grounded).toBe(false);
    let landed = 0;
    for (let i = 0; i < 120 && !m.grounded; i++) {
      m.update(0.016, still, mods, grid);
      if (m.events.landed > 0) landed = m.events.landed;
    }
    expect(m.grounded).toBe(true);
    expect(landed).toBeGreaterThan(3);
    expect(m.y).toBeCloseTo(layout.floorY[c]!, 3);
  });

  it("descend l'escalier du Noyau sans chute", () => {
    const stairs: number[] = [];
    for (let c = 0; c < layout.kind.length; c++) if (layout.kind[c] === CellKind.Stairs) stairs.push(c);
    const top = stairs.reduce((a, b) => (layout.floorY[a]! > layout.floorY[b]! ? a : b));
    const dx = -Math.sign(layout.slopeX[top]!);
    const dz = -Math.sign(layout.slopeZ[top]!);
    const m = new PlayerMotor();
    // Départ sur le palier haut, face à la descente.
    const sx = cellCenterX(top) - dx * CELL;
    const sz = cellCenterZ(top) - dz * CELL;
    m.teleport(sx, grid.heightAt(sx, sz), sz, Math.atan2(dx, dz));
    expect(m.y).toBeCloseTo(0, 1);
    let maxFall = 0;
    for (let i = 0; i < 400; i++) {
      m.update(0.02, { ...still, forward: 1 }, mods, grid);
      maxFall = Math.max(maxFall, m.events.landed);
    }
    expect(m.y).toBeLessThan(-3.9);
    expect(maxFall).toBeLessThan(4);
  });

  it('doit rester accroupi dans un conduit', () => {
    let conduit = -1;
    for (let c = 0; c < layout.kind.length; c++) if (layout.kind[c] === CellKind.Conduit) conduit = c;
    expect(conduit).toBeGreaterThanOrEqual(0);
    const m = new PlayerMotor();
    m.teleport(cellCenterX(conduit), layout.floorY[conduit]!, cellCenterZ(conduit), 0);
    m.crouching = true;
    m.crouch = 1;
    for (let i = 0; i < 20; i++) m.update(0.02, still, mods, grid);
    expect(m.crouching).toBe(true);
    void DIR_DX;
    void DIR_DY;
  });
});

describe('physiologie', () => {
  it("la course épuise l'endurance, qui revient plus lentement sous stress", () => {
    const sim = new PlayerSimulation();
    for (let i = 0; i < 200; i++) sim.update(0.05, { ...calm, moving: true, sprinting: true });
    expect(sim.stamina).toBe(0);
    expect(sim.canSprint()).toBe(false);
    const relaxed = new PlayerSimulation();
    relaxed.stamina = 10;
    const stressed = new PlayerSimulation();
    stressed.stamina = 10;
    stressed.stress = 90;
    for (let i = 0; i < 100; i++) {
      relaxed.update(0.05, calm);
      stressed.update(0.05, { ...calm, chased: true });
    }
    expect(relaxed.stamina).toBeGreaterThan(stressed.stamina + 10);
  });

  it('la surcharge accélère la fatigue et ralentit', () => {
    const light = new PlayerSimulation();
    const heavy = new PlayerSimulation();
    for (let i = 0; i < 60; i++) {
      light.update(0.05, { ...calm, moving: true, sprinting: true });
      heavy.update(0.05, { ...calm, moving: true, sprinting: true, encumbrance: 1 });
    }
    expect(heavy.stamina).toBeLessThan(light.stamina);
    expect(heavy.speedFactor(1)).toBeLessThan(light.speedFactor(0));
  });

  it('le stress monte quand on est poursuivi ou isolé, redescend au calme', () => {
    const sim = new PlayerSimulation();
    for (let i = 0; i < 100; i++) sim.update(0.05, { ...calm, chased: true, seesEntity: true });
    const peak = sim.stress;
    expect(peak).toBeGreaterThan(40);
    for (let i = 0; i < 400; i++) sim.update(0.05, calm);
    expect(sim.stress).toBeLessThan(peak / 2);
    const lonely = new PlayerSimulation();
    for (let i = 0; i < 400; i++) lonely.update(0.05, { ...calm, isolated: true, inDark: true });
    expect(lonely.stress).toBeGreaterThan(10);
  });

  it('chaque type de blessure a un effet réel', () => {
    const sim = new PlayerSimulation();
    sim.damage(20, 'fracture', 'test');
    expect(sim.canSprint()).toBe(false);
    expect(sim.canJump()).toBe(false);
    expect(sim.speedFactor(0)).toBeLessThan(0.7);
    sim.treatWorst();
    expect(sim.canSprint()).toBe(true);
    expect(sim.speedFactor(0)).toBeLessThan(1);

    const burned = new PlayerSimulation();
    burned.damage(15, 'brulure', 'test');
    expect(burned.maxStamina()).toBeLessThan(100);

    const bleeding = new PlayerSimulation();
    bleeding.damage(20, 'profonde', 'test');
    const before = bleeding.health;
    for (let i = 0; i < 200; i++) bleeding.update(0.05, calm);
    expect(bleeding.health).toBeLessThan(before - 3);
    bleeding.treatWorst();
    const stable = bleeding.health;
    for (let i = 0; i < 200; i++) bleeding.update(0.05, calm);
    expect(bleeding.health).toBeGreaterThanOrEqual(stable);

    const dazed = new PlayerSimulation();
    dazed.damage(10, 'traumatisme', 'test');
    expect(dazed.perception().blur).toBeGreaterThan(0.3);
  });

  it('meurt quand la santé tombe à zéro et le signale une seule fois', () => {
    const sim = new PlayerSimulation();
    let deaths = 0;
    sim.events.on('died', () => deaths++);
    sim.damage(60, 'profonde', 'test');
    sim.damage(60, 'profonde', 'test');
    sim.damage(60, 'profonde', 'test');
    expect(sim.alive).toBe(false);
    expect(deaths).toBe(1);
  });

  it("l'infection progresse en zone contaminée et ne recule qu'avec un sérum", () => {
    const sim = new PlayerSimulation();
    sim.random = () => 0.5;
    for (let i = 0; i < 600; i++) sim.update(0.05, { ...calm, contamination: 0.6 });
    const level = sim.infection;
    expect(level).toBeGreaterThan(10);
    for (let i = 0; i < 600; i++) sim.update(0.05, calm);
    expect(sim.infection).toBeGreaterThanOrEqual(level);
    sim.cureInfection();
    expect(sim.infection).toBe(0);
  });

  it("l'apnée supprime le bruit de respiration mais finit par forcer une reprise d'air", () => {
    const sim = new PlayerSimulation();
    sim.stamina = 5;
    for (let i = 0; i < 20; i++) sim.update(0.05, calm);
    expect(sim.breathNoise).toBeGreaterThan(1);
    let gasped = false;
    sim.events.on('gasp', () => (gasped = true));
    for (let i = 0; i < 20; i++) sim.update(0.05, { ...calm, holdingBreath: true });
    expect(sim.breathNoise).toBe(0);
    for (let i = 0; i < 600 && !gasped; i++) sim.update(0.05, { ...calm, holdingBreath: true });
    expect(gasped).toBe(true);
    expect(sim.canHoldBreath()).toBe(false);
  });

  it('le froid fait baisser la température corporelle', () => {
    const sim = new PlayerSimulation();
    for (let i = 0; i < 6000; i++) sim.update(0.1, { ...calm, ambientTemp: 5 });
    expect(sim.bodyTemp).toBeLessThan(35.5);
  });
});

describe('inventaire', () => {
  it('limite les emplacements et le poids', () => {
    const inv = new Inventory();
    expect(inv.add('lampe')).toBe(true);
    expect(inv.add('outils')).toBe(true); // 2 emplacements
    expect(inv.usedSlots()).toBe(3);
    for (let i = 0; i < 5; i++) inv.add('fusible');
    expect(inv.usedSlots()).toBe(INVENTORY_SLOTS);
    expect(inv.cannotAdd('radio')).toBe('Inventaire plein');
    const heavy = new Inventory();
    for (let i = 0; i < 3; i++) heavy.add('cellule');
    expect(heavy.cannotAdd('cellule')).toBe('Trop lourd');
    expect(heavy.encumbrance()).toBeGreaterThan(0.5);
  });

  it('empile piles et marqueurs', () => {
    const inv = new Inventory();
    inv.add('piles', 1);
    inv.add('piles', 1);
    expect(inv.count('piles')).toBe(1);
    expect(inv.find('piles')!.charge).toBe(2);
  });

  it('décharge les appareils allumés et se recharge avec des piles', () => {
    const inv = new Inventory();
    inv.add('lampe');
    inv.add('piles', 1);
    const lamp = inv.find('lampe')!;
    lamp.on = true;
    inv.drain(240);
    expect(lamp.charge).toBeLessThan(60);
    inv.drain(400);
    expect(lamp.charge).toBe(0);
    expect(lamp.on).toBe(false);
    inv.select(0);
    expect(inv.reload()).toBeNull();
    expect(lamp.charge).toBe(100);
    expect(inv.find('piles')).toBeNull();
    lamp.charge = 10;
    expect(inv.reload()).toBe('Aucune pile');
  });

  it('retient le meilleur niveau de carte', () => {
    const inv = new Inventory();
    inv.add('carte', undefined, '1');
    inv.add('carte', undefined, '3');
    expect(inv.cardLevel()).toBe(3);
  });
});
