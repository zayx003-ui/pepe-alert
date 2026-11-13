/**
 * Cerveaux des entités : une machine à états par espèce.
 * `think` (quelques fois par seconde) prend les décisions à partir des
 * perceptions ; `act` (chaque image) exécute le déplacement.
 */
import { dist, dist2 } from '../core/math';
import { cellCenterX, cellCenterZ } from '../world/types';
import type { AIContext, EntityAgent, TargetInfo } from './agent';
import type { EntityKind } from './specs';

export interface Brain {
  initial: string;
  think(a: EntityAgent, ctx: AIContext, dt: number): void;
  act(a: EntityAgent, ctx: AIContext, dt: number): void;
}

/** Durée de la préparation d'une attaque (laisse une chance d'esquive). */
const WINDUP = 0.55;

function isolated(t: TargetInfo, ctx: AIContext, radius = 9): boolean {
  for (const o of ctx.targets) {
    if (o !== t && o.alive && dist2(o.x, o.z, t.x, t.z) < radius * radius) return false;
  }
  return true;
}

function anyoneSees(x: number, z: number, ctx: AIContext, range = 30): boolean {
  for (const t of ctx.targets) {
    if (!t.alive) continue;
    if (dist2(t.x, t.z, x, z) < range * range && ctx.state.grid.sight(t.x, t.z, x, z)) return true;
  }
  return false;
}

function strike(a: EntityAgent, ctx: AIContext, t: TargetInfo): void {
  ctx.emit({ type: 'attack', uid: a.uid, target: t.id, damage: a.spec.attackDamage, injury: a.spec.attackInjury, kind: a.kind });
  a.cooldown = a.spec.recovery;
}

/** Errance entre des cellules du territoire. */
function wander(a: EntityAgent, ctx: AIContext, dt: number, speed: number): void {
  if (!a.hasPath()) {
    a.timer -= dt;
    a.anim = 0;
    if (a.timer <= 0) {
      a.goToCell(a.randomHomeCell(ctx), ctx);
      a.timer = ctx.rng.range(1.5, 5);
    }
    return;
  }
  a.follow(dt, speed, ctx);
}

/* ================================================================== */
/* LE VISITEUR                                                         */
/* ================================================================== */

/** Cherche une cellule proche d'un joueur mais hors de toute vue. */
function hiddenCellNear(a: EntityAgent, ctx: AIContext, t: TargetInfo, min: number, max: number): number {
  const grid = ctx.state.grid;
  const layout = grid.layout;
  const cell = grid.cellAt(t.x, t.z);
  if (cell < 0) return -1;
  const sector = layout.sectorOf[cell]!;
  for (let tries = 0; tries < 24; tries++) {
    const region = ctx.rng.pick(layout.regions);
    if (region.kind === 'conduit' || region.kind === 'elevator' || region.secret) continue;
    const c = ctx.rng.pick(region.cells);
    if (layout.sectorOf[c] !== sector && tries < 16) continue;
    if (layout.blocked[c]) continue;
    const x = cellCenterX(c);
    const z = cellCenterZ(c);
    const d = dist(x, z, t.x, t.z);
    if (d < min || d > max) continue;
    if (anyoneSees(x, z, ctx)) continue;
    return c;
  }
  return -1;
}

/** Cellule à distance d'un joueur et en ligne de vue directe (pour les mirages). */
function visibleCellNear(ctx: AIContext, t: TargetInfo, min: number, max: number): number {
  const grid = ctx.state.grid;
  for (let tries = 0; tries < 16; tries++) {
    const angle = ctx.rng.range(0, Math.PI * 2);
    const d = ctx.rng.range(min, max);
    const x = t.x + Math.sin(angle) * d;
    const z = t.z + Math.cos(angle) * d;
    const c = grid.cellAt(x, z);
    if (c < 0 || !grid.walkable(x, z) || grid.layout.blocked[c]) continue;
    if (grid.sight(t.x, t.z, cellCenterX(c), cellCenterZ(c))) return c;
  }
  return -1;
}

const FAKES = ['pas', 'voix', 'porte', 'radio', 'pas', 'voix'] as const;

const visiteur: Brain = {
  initial: 'dormant',

  think(a, ctx) {
    a.perceive(ctx);
    a.observer = a.observedBy(ctx);
    const power = ctx.state.mainPower;
    const aggression = Math.min(1, a.traits.aggression + ctx.threat * 0.35 + (power ? 0.15 : 0));
    switch (a.state) {
      case 'dormant': {
        a.visible = false;
        const startled = a.heard !== null && a.heard.margin > 8;
        if (a.stateTime >= a.wakeIn || (startled && a.stateTime > 10)) a.setState('repositionnement');
        break;
      }
      case 'repositionnement': {
        // Réapparaît près d'une zone d'activité, jamais sous les yeux d'un joueur.
        const prey = a.target(ctx) ?? (ctx.targets.length ? ctx.rng.pick(ctx.targets) : null);
        if (!prey || !prey.alive) {
          a.wakeIn = 20;
          a.setState('dormant');
          break;
        }
        const cell = hiddenCellNear(a, ctx, prey, 12, 26);
        if (cell >= 0) {
          a.place(cell, ctx);
          a.visible = true;
          a.targetId = prey.id;
          a.gaze = 0;
          a.counter = 0;
          a.setState('observation');
        } else if (a.stateTime > 12) {
          a.wakeIn = 15;
          a.setState('dormant');
        }
        break;
      }
      case 'observation': {
        if (a.observer && (a.observer.lightOn || a.isLit(a, ctx))) {
          if (a.gaze > 1.4) {
            ctx.emit({ type: 'stress', target: a.observer.id, amount: 10 });
            a.setState('disparition');
            break;
          }
        } else a.gaze = Math.max(0, a.gaze - 0.3);
        if (a.seen && a.distanceTo(a.seen) < 4.5) {
          a.setState(isolated(a.seen, ctx) || aggression > 0.6 ? 'chasse' : 'disparition');
          break;
        }
        const watchTime = 8 + a.traits.patience * 22;
        if (a.stateTime > watchTime) {
          const prey = a.seen ?? a.target(ctx);
          const alone = prey ? isolated(prey, ctx) : false;
          const wImitate = a.traits.cunning * (alone ? 0.6 : 1.4);
          const wApproach = aggression * (alone ? 2 : 0.8);
          const roll = ctx.rng.next() * (wImitate + wApproach + 0.3);
          if (roll < wImitate) a.setState('imitation');
          else if (roll < wImitate + wApproach) a.setState(a.memoryFresh(ctx) ? 'approche' : 'investigation');
          else a.setState('repositionnement');
        } else if (!a.seen && a.heard && a.heard.margin > 3) a.setState('investigation');
        break;
      }
      case 'investigation': {
        if (a.seen) {
          a.setState(a.distanceTo(a.seen) < 8 && aggression > 0.55 ? 'chasse' : 'approche');
          break;
        }
        if (a.lastKnown && !a.hasPath() && a.counter === 0) {
          if (!a.goTo(a.lastKnown.x, a.lastKnown.z, ctx)) a.counter = 1;
        }
        if (a.stateTime > 26 || !a.lastKnown) a.setState(a.heat.size > 0 ? 'observation' : 'repositionnement');
        break;
      }
      case 'imitation': {
        const prey = a.target(ctx);
        if (!prey) {
          a.setState('repositionnement');
          break;
        }
        if (a.seen && a.distanceTo(a.seen) < 5.5) {
          a.setState(isolated(a.seen, ctx) || aggression > 0.5 ? 'attaque' : 'chasse');
          break;
        }
        if (a.counter === 0) {
          // Choisit un poste de leurre hors de vue.
          const cell = hiddenCellNear(a, ctx, prey, 8, 18);
          if (cell >= 0) a.goToCell(cell, ctx);
          a.counter = 1;
          a.timer = 3;
        }
        if (a.timer <= 0) {
          a.timer = ctx.rng.range(4, 8);
          const what = ctx.rng.pick(FAKES);
          const others = ctx.targets.filter((t) => t.alive && t.id !== prey.id);
          const as = others.length ? ctx.rng.pick(others).id : prey.id;
          ctx.emit({ type: 'fake', what, x: a.x, z: a.z, as, uid: a.uid });
          if (ctx.rng.chance(0.2 + 0.4 * a.traits.cunning)) {
            // Fausse silhouette d'un coéquipier, placée bien en vue de la proie.
            const cell = visibleCellNear(ctx, prey, 9, 22);
            if (cell >= 0) ctx.emit({ type: 'fake', what: 'mirage', x: cellCenterX(cell), z: cellCenterZ(cell), as, uid: a.uid });
          }
        }
        if (a.stateTime > 22 + a.traits.patience * 20) a.setState(a.memoryFresh(ctx) ? 'approche' : 'observation');
        break;
      }
      case 'approche': {
        const prey = a.seen ?? null;
        if (prey && a.distanceTo(prey) < 6.5) {
          a.setState('chasse');
          break;
        }
        if (a.observer && a.observer.lightOn && a.gaze > 2.6) {
          a.setState(a.distanceTo(a.observer) < 7 ? 'chasse' : 'disparition');
          break;
        }
        if (!a.memoryFresh(ctx)) {
          a.setState('investigation');
          break;
        }
        if (a.lastKnown) a.goTo(a.lastKnown.x, a.lastKnown.z, ctx);
        if (a.stateTime > 40) a.setState('observation');
        break;
      }
      case 'chasse': {
        if (a.seen) {
          a.goTo(a.seen.x, a.seen.z, ctx);
          if (a.distanceTo(a.seen) < a.spec.attackRange) a.setState('attaque');
        } else if (a.lastKnown && a.memoryFresh(ctx)) {
          a.goTo(a.lastKnown.x, a.lastKnown.z, ctx);
        } else a.setState('investigation');
        if (a.stateTime > 30) a.setState('disparition');
        break;
      }
      case 'attaque': {
        if (a.stateTime >= WINDUP) {
          const prey = a.target(ctx);
          if (prey && a.distanceTo(prey) < a.spec.attackRange + 0.5 && (prey.hiddenIn || ctx.state.grid.sight(a.x, a.z, prey.x, prey.z))) {
            strike(a, ctx, prey);
            a.setState('disparition');
          } else a.setState('chasse');
        }
        break;
      }
      case 'disparition': {
        if (a.counter === 0) {
          a.goToCell(a.randomHomeCell(ctx), ctx);
          a.counter = 1;
        }
        const seenByPlayers = anyoneSees(a.x, a.z, ctx, 26);
        if (!seenByPlayers) a.timer += 0.2;
        else a.timer = 0;
        if (a.timer > 1 || a.stateTime > 9) {
          a.visible = false;
          a.clearPath();
          const base = a.cooldown > 0 ? a.spec.recovery : 14;
          a.wakeIn = base * (1.3 - aggression * 0.6) + ctx.rng.range(0, 10);
          a.cooldown = 0;
          a.setState('dormant');
        }
        break;
      }
    }
  },

  act(a, ctx, dt) {
    if (a.observer) a.gaze += dt;
    const slow = ctx.state.mainPower ? 1 : 0.86;
    switch (a.state) {
      case 'dormant':
      case 'repositionnement':
        a.anim = 0;
        break;
      case 'observation':
        a.anim = 0;
        if (a.seen) a.face(a.seen.x, a.seen.z, dt);
        else if (a.lastKnown && a.memoryFresh(ctx) && a.distanceTo(a.lastKnown) > 14) {
          a.goTo(a.lastKnown.x, a.lastKnown.z, ctx);
          a.follow(dt, a.spec.patrolSpeed, ctx);
        }
        break;
      case 'investigation':
        if (a.hasPath()) a.follow(dt, a.spec.patrolSpeed * 1.25, ctx);
        else {
          // Balaye la pièce du regard.
          a.anim = 0;
          a.yaw += dt * 0.9;
        }
        break;
      case 'imitation':
        a.timer -= dt;
        if (a.hasPath()) a.follow(dt, a.spec.patrolSpeed, ctx);
        else a.anim = 0;
        break;
      case 'approche':
        // Se fige lorsqu'on l'éclaire.
        if (a.observer && a.observer.lightOn) a.anim = 0;
        else a.follow(dt, a.spec.patrolSpeed * 1.3, ctx);
        break;
      case 'chasse': {
        let speed = a.spec.huntSpeed * slow;
        // Un groupe soudé qui le fixe le fait hésiter.
        if (a.observer && !isolated(a.observer, ctx, 4)) speed *= 0.6;
        a.follow(dt, speed, ctx);
        break;
      }
      case 'attaque': {
        a.anim = 3;
        const prey = a.target(ctx);
        if (prey) a.face(prey.x, prey.z, dt * 2);
        break;
      }
      case 'disparition':
        a.follow(dt, a.spec.huntSpeed, ctx);
        break;
    }
  },
};

/* ================================================================== */
/* L'ÉCHO                                                              */
/* ================================================================== */

const echo: Brain = {
  initial: 'patrouille',

  think(a, ctx, dt) {
    a.heard = a.listen(ctx);
    a.cooldown -= dt;
    // Cliquetis : révèle tout ce qui bouge à proximité.
    a.gaze -= dt;
    if (a.gaze <= 0 && a.state !== 'attaque') {
      a.gaze = ctx.rng.range(3.5, 6);
      ctx.emit({ type: 'sound', uid: a.uid, sound: 'clic', x: a.x, z: a.z, radius: 16 });
      for (const t of ctx.targets) {
        if (t.alive && !t.hiddenIn && t.speed > 0.5 && dist2(a.x, a.z, t.x, t.z) < 25) {
          a.heard = { x: t.x, z: t.z, margin: 6, source: t.id };
        }
      }
    }
    if (a.heard) a.remember(a.heard.x, a.heard.z, a.heard.source, ctx);
    switch (a.state) {
      case 'patrouille':
        if (a.heard) {
          a.setState(a.heard.margin > 5 ? 'charge' : 'ecoute');
          a.counter = 1;
        }
        break;
      case 'ecoute':
        if (a.heard) {
          a.counter++;
          if (a.counter >= 2 || a.heard.margin > 4) a.setState('charge');
          else a.goTo(a.heard.x, a.heard.z, ctx);
        } else if (a.lastKnown && !a.hasPath() && a.stateTime < 1) a.goTo(a.lastKnown.x, a.lastKnown.z, ctx);
        if (a.stateTime > 14) {
          a.counter = 0;
          a.setState('patrouille');
        }
        break;
      case 'charge': {
        if (a.lastKnown) a.goTo(a.lastKnown.x, a.lastKnown.z, ctx);
        for (const t of ctx.targets) {
          if (!t.alive) continue;
          const d = a.distanceTo(t);
          // Au contact, même le silence ne protège plus.
          if (d < 1.1 || (d < a.spec.attackRange && t.noise > 0.5)) {
            if (a.cooldown <= 0 && Math.abs(t.y - a.y) < 2) {
              a.targetId = t.id;
              a.setState('attaque');
            }
          }
        }
        if (!a.hasPath() && a.stateTime > 1.5) a.setState('ecoute');
        if (a.stateTime > 16) a.setState('ecoute');
        break;
      }
      case 'attaque':
        if (a.stateTime >= 0.45) {
          const t = a.target(ctx);
          if (t && a.distanceTo(t) < a.spec.attackRange + 0.4) strike(a, ctx, t);
          a.setState('recuperation');
        }
        break;
      case 'recuperation':
        if (a.stateTime > 4) {
          a.counter = 0;
          a.setState('patrouille');
        }
        break;
    }
  },

  act(a, ctx, dt) {
    switch (a.state) {
      case 'patrouille':
        wander(a, ctx, dt, a.spec.patrolSpeed);
        break;
      case 'ecoute':
        if (a.hasPath()) a.follow(dt, 2.6, ctx);
        else a.anim = 0;
        break;
      case 'charge':
        a.follow(dt, a.spec.huntSpeed, ctx);
        break;
      case 'attaque':
        a.anim = 3;
        break;
      default:
        a.anim = 0;
        break;
    }
  },
};

/* ================================================================== */
/* LE PHOTOTROPE                                                       */
/* ================================================================== */

const phototrope: Brain = {
  initial: 'derive',

  think(a, ctx, dt) {
    a.cooldown -= dt;
    let light: TargetInfo | null = null;
    let bd = Infinity;
    for (const t of ctx.targets) {
      if (!a.seesLight(t, ctx)) continue;
      const d = dist2(a.x, a.z, t.x, t.z);
      if (d < bd) {
        bd = d;
        light = t;
      }
    }
    a.seen = light;
    if (light) {
      a.targetId = light.id;
      a.remember(light.x, light.z, light.id, ctx);
    }
    switch (a.state) {
      case 'derive': {
        if (light && a.cooldown <= 0) {
          a.setState('attirance');
          break;
        }
        // Marqueurs lumineux : un leurre qu'elle finit par absorber.
        let best = -1;
        let md = 12 * 12;
        ctx.state.markers.forEach((m, i) => {
          const d = dist2(a.x, a.z, m.x, m.z);
          if (d < md && ctx.state.grid.sight(a.x, a.z, m.x, m.z)) {
            md = d;
            best = i;
          }
        });
        if (best >= 0) {
          const m = ctx.state.markers[best]!;
          if (md < 1.2) {
            a.counter++;
            if (a.counter > 25) {
              ctx.emit({ type: 'marker', id: m.id });
              a.counter = 0;
            }
          } else a.goTo(m.x, m.z, ctx);
        }
        break;
      }
      case 'attirance':
        if (light) {
          a.goTo(light.x, light.z, ctx);
          if (a.distanceTo(light) < 7) a.setState('frenesie');
        } else if (!a.memoryFresh(ctx)) a.setState('derive');
        else if (a.lastKnown) a.goTo(a.lastKnown.x, a.lastKnown.z, ctx);
        break;
      case 'frenesie': {
        const t = a.target(ctx);
        if (light) a.goTo(light.x, light.z, ctx);
        else if (a.stateTime > 2 && (!a.lastKnown || ctx.time - a.lastKnown.time > 2)) {
          a.setState('derive');
          break;
        }
        if (t && light && a.distanceTo(t) < a.spec.attackRange && a.cooldown <= 0) {
          strike(a, ctx, t);
          a.setState('derive');
          a.clearPath();
        }
        if (a.stateTime > 14) a.setState('derive');
        break;
      }
    }
  },

  act(a, ctx, dt) {
    if (a.state === 'derive') wander(a, ctx, dt, a.spec.patrolSpeed);
    else if (a.state === 'attirance') a.follow(dt, 2.6, ctx);
    else a.follow(dt, a.spec.huntSpeed, ctx);
  },
};

/* ================================================================== */
/* LE RAMPANT                                                          */
/* ================================================================== */

const rampant: Brain = {
  initial: 'affut',

  think(a, ctx, dt) {
    a.perceive(ctx);
    a.cooldown -= dt;
    switch (a.state) {
      case 'affut':
        a.gaze -= dt;
        if (a.cooldown <= 0 && (a.seen || a.heard)) {
          a.setState('traque');
          break;
        }
        if (a.gaze <= 0 && !a.hasPath()) {
          // Change de poste en raclant dans le conduit : un avertissement audible.
          a.gaze = ctx.rng.range(18, 40);
          a.goToCell(a.randomHomeCell(ctx), ctx);
          ctx.emit({ type: 'sound', uid: a.uid, sound: 'raclement', x: a.x, z: a.z, radius: 12 });
        }
        break;
      case 'traque':
        if (a.seen && a.distanceTo(a.seen) < 5) {
          a.setState('assaut');
          ctx.emit({ type: 'sound', uid: a.uid, sound: 'cri_rampant', x: a.x, z: a.z, radius: 18 });
          break;
        }
        if (a.lastKnown && a.memoryFresh(ctx)) {
          if (!a.goTo(a.lastKnown.x, a.lastKnown.z, ctx)) a.setState('affut');
        } else if (a.stateTime > 4) a.setState('embuscade');
        if (a.stateTime > 25) a.setState('affut');
        break;
      case 'embuscade':
        if (a.seen && a.distanceTo(a.seen) < 5) {
          a.setState('assaut');
          ctx.emit({ type: 'sound', uid: a.uid, sound: 'cri_rampant', x: a.x, z: a.z, radius: 18 });
        } else if (a.heard) a.setState('traque');
        else if (a.stateTime > 9) a.setState('affut');
        break;
      case 'assaut': {
        const t = a.seen ?? a.target(ctx);
        if (t) a.goTo(t.x, t.z, ctx);
        if (t && a.distanceTo(t) < a.spec.attackRange && a.cooldown <= 0 && a.stateTime > 0.3) {
          strike(a, ctx, t);
          a.setState('repli');
        } else if (a.stateTime > 7) {
          a.cooldown = a.spec.recovery * 0.5;
          a.setState('repli');
        }
        break;
      }
      case 'repli':
        if (a.counter === 0) {
          a.goToCell(a.randomHomeCell(ctx), ctx);
          a.counter = 1;
        }
        if (!a.hasPath() || a.stateTime > 20) {
          a.counter = 0;
          a.setState('affut');
        }
        break;
    }
  },

  act(a, ctx, dt) {
    switch (a.state) {
      case 'affut':
        if (a.hasPath()) a.follow(dt, 1.4, ctx);
        else a.anim = 0;
        break;
      case 'traque':
        a.follow(dt, a.spec.patrolSpeed, ctx);
        break;
      case 'embuscade':
        a.anim = 0;
        break;
      case 'assaut':
        // Bond initial hors de la grille, puis il s'essouffle à découvert.
        a.follow(dt, a.stateTime < 0.8 ? 6 : a.spec.huntSpeed, ctx);
        break;
      case 'repli':
        a.follow(dt, 3, ctx);
        break;
    }
  },
};

/* ================================================================== */
/* LE PORTEUR                                                          */
/* ================================================================== */

const porteur: Brain = {
  initial: 'errance',

  think(a, ctx, dt) {
    a.perceive(ctx);
    a.cooldown -= dt;
    // Aura contaminante.
    for (const t of ctx.targets) {
      if (t.alive && !t.hiddenIn && dist2(a.x, a.z, t.x, t.z) < 9 && ctx.state.grid.sight(a.x, a.z, t.x, t.z)) {
        ctx.emit({ type: 'infect', target: t.id, amount: 2.5 * dt });
      }
    }
    switch (a.state) {
      case 'errance':
        if (a.seen || a.heard) a.setState('poursuite');
        break;
      case 'poursuite': {
        if (!a.memoryFresh(ctx)) {
          a.setState('errance');
          break;
        }
        const t = a.seen;
        if (t && a.distanceTo(t) < a.spec.attackRange && a.cooldown <= 0) {
          a.targetId = t.id;
          a.setState('attaque');
          break;
        }
        // Chemin coupé par une porte fermée : il reste planté devant.
        if (a.lastKnown && !a.goTo(a.lastKnown.x, a.lastKnown.z, ctx)) a.setState('bloque');
        break;
      }
      case 'bloque':
        if (a.lastKnown && a.goTo(a.lastKnown.x, a.lastKnown.z, ctx)) a.setState('poursuite');
        else if (a.stateTime > 12) a.setState('errance');
        break;
      case 'attaque':
        if (a.stateTime >= WINDUP) {
          const t = a.target(ctx);
          if (t && a.distanceTo(t) < a.spec.attackRange + 0.4) {
            strike(a, ctx, t);
            ctx.emit({ type: 'infect', target: t.id, amount: 18 });
          }
          a.setState('poursuite');
        }
        break;
    }
  },

  act(a, ctx, dt) {
    if (a.state === 'errance') wander(a, ctx, dt, a.spec.patrolSpeed);
    else if (a.state === 'poursuite') a.follow(dt, a.spec.huntSpeed, ctx);
    else if (a.state === 'attaque') a.anim = 3;
    else a.anim = 0;
  },
};

/* ================================================================== */
/* LE STATIQUE                                                         */
/* ================================================================== */

const statique: Brain = {
  initial: 'veille',

  think(a, ctx, dt) {
    a.cooldown -= dt;
    let prey: TargetInfo | null = null;
    let best = 0;
    for (const t of ctx.targets) {
      if (!t.alive || t.devices <= 0) continue;
      const d = a.distanceTo(t);
      if (d > 25) continue;
      const score = t.devices / (d + 2);
      if (score > best) {
        best = score;
        prey = t;
      }
    }
    if (prey) {
      a.targetId = prey.id;
      a.remember(prey.x, prey.z, prey.id, ctx);
    }
    switch (a.state) {
      case 'veille':
        a.visible = true;
        if (prey && a.cooldown <= 0) a.setState('attraction');
        break;
      case 'attraction': {
        if (!prey) {
          if (!a.memoryFresh(ctx)) a.setState('veille');
          break;
        }
        const d = a.distanceTo(prey);
        if (d < 8) ctx.emit({ type: 'drain', target: prey.id, factor: 6 });
        if (d < a.spec.attackRange) {
          a.counter++;
          if (a.counter * dt >= 2) {
            strike(a, ctx, prey);
            ctx.emit({ type: 'sound', uid: a.uid, sound: 'decharge', x: a.x, z: a.z, radius: 22 });
            a.counter = 0;
            a.setState('dissipe');
          }
        } else a.counter = 0;
        break;
      }
      case 'dissipe':
        a.visible = false;
        if (a.stateTime > 6) {
          a.place(a.randomHomeCell(ctx), ctx);
          a.setState('veille');
        }
        break;
    }
  },

  act(a, ctx, dt) {
    if (a.state === 'veille') {
      a.timer -= dt;
      if (a.timer <= 0) {
        const c = a.randomHomeCell(ctx);
        a.goalX = cellCenterX(c);
        a.goalZ = cellCenterZ(c);
        a.timer = ctx.rng.range(6, 14);
      }
      if (dist2(a.x, a.z, a.goalX, a.goalZ) > 0.5) a.step(dt, a.goalX, a.goalZ, a.spec.patrolSpeed, ctx);
    } else if (a.state === 'attraction' && a.lastKnown) {
      // Ligne droite : les cloisons ne l'arrêtent pas.
      if (dist2(a.x, a.z, a.lastKnown.x, a.lastKnown.z) > 1) a.step(dt, a.lastKnown.x, a.lastKnown.z, a.spec.huntSpeed, ctx);
    }
  },
};

export const BRAINS: Record<EntityKind, Brain> = { visiteur, echo, phototrope, rampant, porteur, statique };
