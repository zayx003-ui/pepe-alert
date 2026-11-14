import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { emptyInput } from '../../src/game/session';
import { createCluster, soloSession } from './helpers';

describe('endurance', () => {
  it('trente minutes de partie solo au hasard : aucune exception, état toujours cohérent', () => {
    const s = soloSession('ENDURANCE');
    const rng = new Rng('errance');
    const input = emptyInput();
    const notices = new Set<string>();
    s.events.on('notice', (n) => notices.add(n.kind));
    let maxStress = 0;
    for (let i = 0; i < 36_000 && !s.result; i++) {
      if (i % 40 === 0) {
        // Toutes les deux secondes : nouvelle direction, nouvelles actions.
        input.forward = rng.pick([1, 1, 1, 0, -1]);
        input.strafe = rng.pick([0, 0, 1, -1]);
        input.sprint = rng.chance(0.3);
        input.crouch = rng.chance(0.15);
        s.motor.yaw += rng.range(-1.2, 1.2);
        s.motor.pitch = rng.range(-0.3, 0.6);
      }
      input.jump = i % 97 === 0;
      input.interactPressed = i % 23 === 0;
      input.interact = i % 23 < 12;
      input.usePressed = i % 301 === 0;
      input.lightPressed = i % 1201 === 0;
      input.dropPressed = i % 4001 === 0;
      input.scroll = i % 53 === 0 ? 1 : 0;
      s.update(0.05, input);
      expect(Number.isFinite(s.motor.x) && Number.isFinite(s.motor.y) && Number.isFinite(s.motor.z)).toBe(true);
      expect(s.world.grid.walkable(s.motor.x, s.motor.z)).toBe(true);
      maxStress = Math.max(maxStress, s.sim.stress);
    }
    // Le monde a vécu : événements dynamiques, menace en hausse, entités actives.
    expect(s.host!.missions.elapsed > 600 || s.result !== null).toBe(true);
    expect(notices.size).toBeGreaterThan(0);
    expect(s.sim.health).toBeGreaterThanOrEqual(0);
    expect(s.sim.health).toBeLessThanOrEqual(100);
    expect(maxStress).toBeGreaterThanOrEqual(0);
    for (const e of s.entities.values()) expect(Number.isFinite(e.x) && Number.isFinite(e.z)).toBe(true);
    // Si le joueur est mort en route, la partie s'est close proprement sur un échec.
    if (s.result) {
      expect(s.result.outcome).toBe('echec');
      expect(s.result.players[0]!.status).toBe('mort');
    }
  }, 120_000);

  it('dix minutes à quatre joueurs en mouvement : mondes identiques chez tous à la fin', async () => {
    const c = await createCluster(4, 'ENDURANCE-4');
    const rng = new Rng('equipe');
    let step = 0;
    c.run(600, () => {
      if (step++ % 40 !== 0) return;
      c.inputs.forEach((inp, i) => {
        inp.forward = rng.pick([1, 1, 0, -1]);
        inp.strafe = rng.pick([0, 1, -1]);
        inp.sprint = rng.chance(0.25);
        inp.interactPressed = rng.chance(0.5);
        c.sessions[i]!.motor.yaw += rng.range(-1, 1);
      });
    });
    c.inputs.forEach((inp) => Object.assign(inp, emptyInput()));
    c.run(10);
    const host = c.sessions.find((s) => s.isHost)!;
    const reference = host.world.snapshot();
    for (const s of c.sessions) {
      if (s === host) continue;
      const snap = s.world.snapshot();
      expect(snap.doors).toEqual(reference.doors);
      expect(snap.fixtures.map(([id, f]) => [id, f.on, f.broken, f.value])).toEqual(reference.fixtures.map(([id, f]) => [id, f.on, f.broken, f.value]));
      expect(snap.items.map((i) => i.uid).sort()).toEqual(reference.items.map((i) => i.uid).sort());
      expect(s.mission?.objectives.map((o) => [o.id, o.status, o.step])).toEqual(host.mission?.objectives.map((o) => [o.id, o.status, o.step]));
    }
  }, 180_000);
});
