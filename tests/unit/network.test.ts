import { describe, expect, it } from 'vitest';
import { MSG } from '../../src/network/protocol';
import { LOADING_TIMEOUT_MS, RECONNECT_GRACE_MS, RoomSession, TIMEOUT_MS } from '../../src/network/room';
import { MemoryHub, MemoryTransport, generateRoomCode } from '../../src/network/transport';
import { DOOR_CLOSED, DOOR_OPEN } from '../../src/world/grid';
import { doorCenter } from '../../src/interaction/actions';
import { closedDoors, createCluster, teleportToCell } from './helpers';

const who = (i: number) => ({ id: `u${i}`, name: `Joueur ${i}`, title: '', color: '#fff' });

async function lobby(n: number, max = 6): Promise<{ hub: MemoryHub; rooms: RoomSession[]; tick(ms: number): void }> {
  const hub = new MemoryHub();
  const now = (): number => hub.now;
  const rooms = [await RoomSession.create(new MemoryTransport(hub), who(1), { maxPlayers: max, seed: 'LOBBY' }, now)];
  for (let i = 2; i <= n; i++) {
    hub.advance(5);
    rooms.push(await RoomSession.join(new MemoryTransport(hub), rooms[0]!.code, who(i), now));
  }
  const tick = (ms: number): void => {
    for (let t = 0; t < ms; t += 250) {
      hub.advance(250);
      for (const r of rooms) if (hub.rooms.has(r.code) || true) r.tick();
    }
  };
  tick(500);
  return { hub, rooms, tick };
}

describe('salons', () => {
  it('code de salon lisible et sans caractères ambigus', () => {
    for (let i = 0; i < 50; i++) expect(generateRoomCode()).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
  });

  it('création, entrée, liste des membres et réglages partagés', async () => {
    const { rooms } = await lobby(3);
    for (const r of rooms) {
      expect(r.list().map((m) => m.id)).toEqual(['u1', 'u2', 'u3']);
      expect(r.hostId).toBe('u1');
      expect(r.settings.seed).toBe('LOBBY');
    }
    rooms[0]!.updateSettings({ seed: 'AUTRE', name: 'Nuit 4' });
    expect(rooms[2]!.settings.seed).toBe('AUTRE');
    expect(rooms[2]!.settings.name).toBe('Nuit 4');
    // Un invité ne peut pas modifier les réglages.
    rooms[1]!.updateSettings({ seed: 'PIRATE' });
    expect(rooms[0]!.settings.seed).toBe('AUTRE');
  });

  it('les salons publics sont listés, les privés non, les codes inconnus refusés', async () => {
    const hub = new MemoryHub();
    const t = new MemoryTransport(hub);
    const pub = await RoomSession.create(t, who(1), { isPublic: true }, () => hub.now);
    await RoomSession.create(t, who(2), { isPublic: false }, () => hub.now);
    const list = await t.listRooms();
    expect(list.map((r) => r.code)).toEqual([pub.code]);
    await expect(RoomSession.join(t, 'ZZZZZ', who(3), () => hub.now)).rejects.toThrow(/introuvable/);
  });

  it('refuse un septième joueur', async () => {
    const { hub, rooms } = await lobby(6);
    const late = await RoomSession.join(new MemoryTransport(hub), rooms[0]!.code, who(7), () => hub.now);
    hub.advance(10);
    expect(late.closedReason).toMatch(/complet/);
    for (const r of rooms) expect(r.members.size).toBe(6);
  });

  it("états : connecté → prêt → chargement → en jeu ; le lancement exige que tous soient prêts", async () => {
    const { hub, rooms, tick } = await lobby(3);
    const [host, a, b] = rooms as [RoomSession, RoomSession, RoomSession];
    expect(host.start('s1')).toBeNull();
    a.setReady(true);
    hub.advance(5);
    expect(host.members.get('u2')!.state).toBe('ready');
    expect(host.start('s1')).toBeNull();
    b.setReady(true);
    hub.advance(5);
    let go = 0;
    for (const r of rooms) r.events.on('go', () => go++);
    const payload = host.start('s1')!;
    expect(payload.roster.map((r) => r.id)).toEqual(['u1', 'u2', 'u3']);
    hub.advance(5);
    expect(a.phase).toBe('loading');
    expect(a.me.state).toBe('loading');
    expect(a.startPayload?.seed).toBe('LOBBY');
    host.markLoaded();
    a.markLoaded();
    hub.advance(5);
    expect(go).toBe(0);
    b.markLoaded();
    tick(500);
    expect(go).toBe(3);
    expect(host.members.get('u3')!.state).toBe('playing');
  });

  it("un joueur bloqué en chargement ne retient pas la partie", async () => {
    const { hub, rooms, tick } = await lobby(2);
    rooms[1]!.setReady(true);
    hub.advance(5);
    let go = false;
    rooms[0]!.events.on('go', () => (go = true));
    rooms[0]!.start('s2');
    rooms[0]!.markLoaded();
    tick(5000);
    expect(go).toBe(false);
    tick(LOADING_TIMEOUT_MS);
    expect(go).toBe(true);
  });

  it('perte de connexion : marqué déconnecté, place conservée, puis reconnexion', async () => {
    const { hub, rooms, tick } = await lobby(3);
    hub.setOnline(rooms[0]!.code, 'u3', false);
    tick(TIMEOUT_MS + 1000);
    expect(rooms[0]!.members.get('u3')!.state).toBe('disconnected');
    expect(rooms[0]!.members.size).toBe(3);
    hub.setOnline(rooms[0]!.code, 'u3', true);
    tick(1000);
    expect(rooms[0]!.members.get('u3')!.state).toBe('connected');
    expect(rooms[2]!.members.size).toBe(3);
    // Au-delà du délai de grâce, la place est libérée.
    hub.setOnline(rooms[0]!.code, 'u3', false);
    tick(RECONNECT_GRACE_MS + 2000);
    expect(rooms[0]!.members.has('u3')).toBe(false);
  });

  it("départ de l'hôte : le membre le plus ancien prend le relais, partout", async () => {
    const { rooms, tick } = await lobby(4);
    rooms[0]!.leave();
    tick(1000);
    for (const r of rooms.slice(1)) {
      expect(r.hostId).toBe('u2');
      expect(r.members.has('u1')).toBe(false);
    }
    expect(rooms[1]!.isHost).toBe(true);
    // Le nouvel hôte peut modifier les réglages.
    rooms[1]!.updateSettings({ seed: 'RELAIS' });
    expect(rooms[3]!.settings.seed).toBe('RELAIS');
  });

  it("disparition silencieuse de l'hôte : relève après le délai, et l'ancien hôte s'incline à son retour", async () => {
    const { hub, rooms, tick } = await lobby(3);
    hub.setOnline(rooms[0]!.code, 'u1', false);
    tick(TIMEOUT_MS + 1500);
    expect(rooms[1]!.hostId).toBe('u2');
    expect(rooms[2]!.hostId).toBe('u2');
    hub.setOnline(rooms[0]!.code, 'u1', true);
    tick(3000);
    expect(rooms[0]!.hostId).toBe('u2');
    expect(rooms[0]!.isHost).toBe(false);
  });

  it("un client figé (chargement, onglet en veille) ne s'élit pas hôte à son réveil", async () => {
    const { hub, rooms, tick } = await lobby(3);
    // Les autres continuent de battre pendant que le troisième est figé vingt secondes.
    for (let t = 0; t < 20_000; t += 250) {
      hub.advance(250);
      rooms[0]!.tick();
      rooms[1]!.tick();
    }
    rooms[2]!.tick();
    expect(rooms[2]!.hostId).toBe('u1');
    expect(rooms[2]!.members.get('u1')!.state).not.toBe('disconnected');
    tick(3000);
    for (const r of rooms) {
      expect(r.hostId).toBe('u1');
      expect(r.list().every((m) => m.state !== 'disconnected')).toBe(true);
    }
  });

  it('le dernier joueur à partir supprime le salon', async () => {
    const { hub, rooms } = await lobby(2);
    const code = rooms[0]!.code;
    rooms[1]!.leave();
    hub.advance(10);
    expect(hub.rooms.has(code)).toBe(true);
    rooms[0]!.leave();
    expect(hub.rooms.has(code)).toBe(false);
  });
});

describe('synchronisation de partie', () => {
  it('deux joueurs partagent la même carte et se voient bouger', async () => {
    const c = await createCluster(2);
    const [a, b] = c.sessions as [typeof c.sessions[0], typeof c.sessions[0]];
    expect(a.isHost).toBe(true);
    expect(b.isHost).toBe(false);
    expect(Array.from(b.layout.edges)).toEqual(Array.from(a.layout.edges));
    c.inputs[1]!.forward = 1;
    c.run(1.5);
    c.inputs[1]!.forward = 0;
    c.run(0.5);
    const seen = a.players.get('joueur-2')!;
    expect(Math.hypot(seen.x - b.motor.x, seen.z - b.motor.z)).toBeLessThan(0.3);
    expect(Math.hypot(b.motor.x - a.layout.spawn.x, b.motor.z - a.layout.spawn.z)).toBeGreaterThan(1);
    expect(b.entities.size).toBe(a.entities.size);
    expect(b.entities.size).toBeGreaterThanOrEqual(8);
    expect(b.mission?.objectives[0]?.id).toBe(a.mission?.objectives[0]?.id);
  });

  it("une porte ouverte par un invité l'est pour tous, après validation par l'hôte", async () => {
    const c = await createCluster(3);
    const guest = c.sessions[1]!;
    const door = guest.layout.doors.find((d) => d.kind === 'door' && !d.lock)!;
    c.sessions[0]!.world.setDoor(door.id, { pos: DOOR_CLOSED });
    c.run(0.3);
    const pos = doorCenter(door);
    guest.motor.teleport(pos.x + 0.4, 0, pos.z + 0.4);
    c.run(0.3); // l'hôte apprend la nouvelle position
    expect(guest.perform({ t: 'door', id: door.id }, 'open')).toBe(true);
    c.run(0.3);
    for (const s of c.sessions) expect(s.world.doors[door.id]!.pos).toBe(DOOR_OPEN);
  });

  it("l'hôte refuse une interaction depuis une position qu'il ne confirme pas", async () => {
    const c = await createCluster(2);
    const guest = c.sessions[1]!;
    const far = guest.layout.doors.find((d) => d.kind === 'door' && !d.lock && Math.hypot(doorCenter(d).x - guest.motor.x, doorCenter(d).z - guest.motor.z) > 30)!;
    c.sessions[0]!.world.setDoor(far.id, { pos: DOOR_CLOSED });
    c.run(0.2);
    // Client falsifié : il se déclare à côté de la porte sans y être pour l'hôte.
    const notices: string[] = [];
    guest.events.on('notice', (n) => notices.push(n.text));
    const pos = doorCenter(far);
    guest.motor.teleport(pos.x, 0, pos.z);
    guest.perform({ t: 'door', id: far.id }, 'open');
    c.hub.advance(50);
    expect(c.sessions[0]!.world.doors[far.id]!.pos).toBe(DOOR_CLOSED);
    expect(notices).toContain('Trop loin');
  });

  it("un objet convoité par deux joueurs n'est attribué qu'une fois", async () => {
    const c = await createCluster(3);
    const item = c.sessions[0]!.layout.items.find((i) => i.item === 'fusible')!;
    for (const s of c.sessions.slice(1)) s.motor.teleport(item.x, item.y, item.z);
    c.run(0.3);
    c.sessions[1]!.perform({ t: 'item', uid: item.uid }, 'take');
    c.sessions[2]!.perform({ t: 'item', uid: item.uid }, 'take');
    c.run(0.3);
    const owners = c.sessions.filter((s) => s.inventory.count('fusible') > 0);
    expect(owners).toHaveLength(1);
    for (const s of c.sessions) expect(s.world.items.has(item.uid)).toBe(false);
  });

  it('objet lâché : il réapparaît au sol chez tout le monde', async () => {
    const c = await createCluster(2);
    const guest = c.sessions[1]!;
    const before = c.sessions[0]!.world.items.size;
    c.inputs[1]!.dropPressed = true;
    c.run(0.05);
    c.inputs[1]!.dropPressed = false;
    c.run(0.3);
    expect(guest.inventory.find('lampe')).toBeNull();
    for (const s of c.sessions) expect(s.world.items.size).toBe(before + 1);
  });

  it('désynchronisation : un client qui manque des opérations redemande l’état complet', async () => {
    const c = await createCluster(2);
    const [host, guest] = c.sessions as [typeof c.sessions[0], typeof c.sessions[0]];
    const doors = closedDoors(host, 8);
    c.run(0.5);
    c.hub.loss = 1; // tout est perdu pendant un moment
    for (const id of doors.slice(0, 6)) host.world.setDoor(id, { pos: DOOR_OPEN });
    c.run(0.5);
    expect(guest.world.doors[doors[2]!]!.pos).toBe(DOOR_CLOSED);
    c.hub.loss = 0;
    host.world.setDoor(doors[7]!, { pos: DOOR_OPEN });
    c.run(3);
    for (const id of doors.slice(0, 6)) expect(guest.world.doors[id]!.pos).toBe(DOOR_OPEN);
    expect(guest.world.snapshot().doors).toEqual(host.world.snapshot().doors);
  });

  it('désynchronisation silencieuse : détectée par le battement de l’hôte', async () => {
    const c = await createCluster(2);
    const [host, guest] = c.sessions as [typeof c.sessions[0], typeof c.sessions[0]];
    const doors = closedDoors(host, 3);
    c.run(0.5);
    c.hub.loss = 1;
    host.world.setDoor(doors[0]!, { pos: DOOR_OPEN });
    c.run(0.3);
    c.hub.loss = 0;
    // Aucune nouvelle opération : seul le battement périodique révèle l'écart.
    c.run(9);
    expect(guest.world.doors[doors[0]!]!.pos).toBe(DOOR_OPEN);
  });

  it('pertes de paquets (20 %) : la partie reste cohérente', async () => {
    const c = await createCluster(3);
    const host = c.sessions[0]!;
    const doors = closedDoors(host, 20);
    c.hub.loss = 0.2;
    let seed = 7;
    c.hub.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let n = 0;
    c.run(8, (t) => {
      if (Math.floor(t * 4) > n) {
        n = Math.floor(t * 4);
        host.world.setDoor(doors[n % 20]!, { pos: n % 2 ? DOOR_OPEN : DOOR_CLOSED });
      }
    });
    c.hub.loss = 0;
    c.run(9);
    for (const s of c.sessions.slice(1)) expect(s.world.snapshot().doors).toEqual(host.world.snapshot().doors);
  });

  it("coupure d'un invité puis retour : il retrouve l'état du monde", async () => {
    const c = await createCluster(3);
    const host = c.sessions[0]!;
    const doors = closedDoors(host, 5);
    c.run(1);
    c.hub.setOnline(c.rooms[0]!.code, 'joueur-3', false);
    c.run(8);
    expect(host.players.get('joueur-3')!.connected).toBe(false);
    for (const id of doors) host.world.setDoor(id, { pos: DOOR_OPEN });
    c.run(1);
    expect(c.sessions[2]!.world.doors[doors[0]!]!.pos).toBe(DOOR_CLOSED);
    c.hub.setOnline(c.rooms[0]!.code, 'joueur-3', true);
    c.run(5);
    expect(host.players.get('joueur-3')!.connected).toBe(true);
    expect(c.sessions[2]!.world.snapshot().doors).toEqual(host.world.snapshot().doors);
  });

  it("départ de l'hôte en pleine partie : un invité reprend l'autorité et la partie continue", async () => {
    const c = await createCluster(3, 'MIGRATION', 'P-MED');
    const host = c.sessions[0]!;
    c.run(8); // laisse circuler l'état des missions
    host.host!.missions.onPickup('fusible');
    host.host!.missions.onPickup('fusible');
    host.host!.missions.onPickup('fusible');
    c.run(8);
    expect(c.sessions[1]!.mission!.objectives[0]!.step).toBe(1);
    const entityCount = c.sessions[1]!.entities.size;
    c.kill(0);
    c.run(TIMEOUT_MS / 1000 + 3);
    const [, a, b] = c.sessions as [typeof host, typeof host, typeof host];
    expect(a.isHost).toBe(true);
    expect(a.host).not.toBeNull();
    expect(b.hostId).toBe('joueur-2');
    expect(a.host!.ai.agents.length).toBe(entityCount);
    // L'avancement de la mission a survécu.
    expect(a.mission!.objectives[0]!.id).toBe('P-MED');
    expect(a.mission!.objectives[0]!.step).toBe(1);
    // Le nouvel hôte valide désormais les actions.
    const door = b.layout.doors.find((d) => d.kind === 'door' && !d.lock)!;
    a.world.setDoor(door.id, { pos: DOOR_CLOSED });
    const pos = doorCenter(door);
    b.motor.teleport(pos.x + 0.3, 0, pos.z + 0.3);
    c.run(0.5);
    b.perform({ t: 'door', id: door.id }, 'open');
    c.run(0.5);
    expect(a.world.doors[door.id]!.pos).toBe(DOOR_OPEN);
    expect(b.world.doors[door.id]!.pos).toBe(DOOR_OPEN);
    expect(a.players.get('joueur-1')!.connected).toBe(false);
  });

  it('discussion : proximité limitée par la distance, radio par l’équipement', async () => {
    const c = await createCluster(3);
    const [a, b, far] = c.sessions as [typeof c.sessions[0], typeof c.sessions[0], typeof c.sessions[0]];
    const farCell = far.layout.regions.find((r) => r.sector === 'administration' && r.kind === 'room')!.cells[0]!;
    teleportToCell(far, farCell);
    c.run(0.3);
    a.sendChat('prox', 'Vous entendez ?');
    c.run(0.2);
    expect(b.chat.map((l) => l.text)).toContain('Vous entendez ?');
    expect(far.chat.map((l) => l.text)).not.toContain('Vous entendez ?');
    // Radio : émetteur et récepteur doivent l'avoir allumée.
    expect(a.sendChat('radio', 'test')).toMatch(/Radio/);
    a.inventory.add('radio');
    a.inventory.find('radio')!.on = true;
    far.inventory.add('radio');
    far.inventory.find('radio')!.on = true;
    // Relais en panne : portée limitée à 45 m.
    const cells = far.layout.regions.filter((r) => r.kind === 'room').flatMap((r) => r.cells);
    const distant = cells.find((cell) => Math.hypot((cell % 80) * 2 - a.motor.x, ((cell / 80) | 0) * 2 - a.motor.z) > 60)!;
    teleportToCell(far, distant);
    c.run(0.3);
    expect(a.sendChat('radio', 'Trop loin ?')).toBeNull();
    c.run(0.2);
    expect(far.chat.map((l) => l.text)).not.toContain('Trop loin ?');
    a.world.setFixture('antenna.accueil', { broken: false, on: true });
    c.run(0.3);
    a.sendChat('radio', 'Ici accueil.');
    c.run(0.2);
    expect(far.chat.some((l) => l.ch === 'radio' && l.name === 'Hôte')).toBe(true);
    expect(b.chat.map((l) => l.text)).not.toContain('Ici accueil.');
  });

  it("un client ne peut pas forger une imitation ni un résultat", async () => {
    const c = await createCluster(2);
    const [host, guest] = c.sessions as [typeof c.sessions[0], typeof c.sessions[0]];
    host.inventory.add('radio');
    host.inventory.find('radio')!.on = true;
    c.rooms[1]!.send(MSG.CHAT, { ch: 'radio', name: 'Hôte', text: 'faux', x: host.motor.x, z: host.motor.z, fake: true });
    c.rooms[1]!.send(MSG.RESULT, { sessionId: 'x', outcome: 'succes' });
    c.rooms[1]!.send(MSG.OPS, { seq: 1, ops: [{ k: 'flag', name: 'extraction_ready', v: 1 }] });
    c.rooms[1]!.send(MSG.DAMAGE, { amount: 100, injury: 'profonde', kind: 'triche' });
    c.run(0.3);
    expect(host.chat.map((l) => l.text)).not.toContain('faux');
    expect(host.result).toBeNull();
    expect(host.world.flag('extraction_ready')).toBe(0);
    expect(host.sim.health).toBe(100);
    void guest;
  });
});

describe('fin de partie', () => {
  it('toute l’équipe morte : échec, résultat identique chez tous', async () => {
    const c = await createCluster(2);
    c.run(1);
    for (const s of c.sessions) s.sim.damage(500, 'profonde', 'test');
    c.run(4);
    for (const s of c.sessions) {
      expect(s.result).not.toBeNull();
      expect(s.result!.outcome).toBe('echec');
      expect(s.result!.players.map((p) => p.status)).toEqual(['mort', 'mort']);
    }
    expect(c.sessions[1]!.result).toEqual(c.sessions[0]!.result);
    // Les inventaires sont tombés au sol.
    expect(c.sessions[0]!.world.items.size).toBeGreaterThan(c.sessions[0]!.layout.items.length);
  });

  it('extraction : objectif accompli, cycle du sas, puis sortie par le sas', async () => {
    const c = await createCluster(2, 'EXTRACTION', 'P-MED');
    const [host, guest] = c.sessions as [typeof c.sessions[0], typeof c.sessions[0]];
    const w = host.world;
    const m = host.host!.missions;
    for (let i = 0; i < 3; i++) m.onPickup('fusible');
    w.setFixture('generator_aux.maintenance', { on: true });
    w.setFixture('fusebox.medical', { value: 3, on: true });
    m.onTerminalUse('terminal.medical');
    w.setFixture('terminal.medical', { value: 1 });
    c.run(1);
    expect(guest.mission!.phase).toBe('extraction');
    expect(guest.world.flag('extraction_ready')).toBe(1);

    const airlock = w.fixtureDefs.get('airlock.accueil')!;
    guest.motor.teleport(airlock.x, 0, airlock.z);
    c.run(0.3);
    expect(guest.perform({ t: 'fx', id: airlock.id }, 'cycle')).toBe(true);
    c.run(0.5);
    expect(host.world.flag('airlock')).toBe(1);
    // Accélère la fin du cycle.
    w.setFixture(airlock.id, { t: 0.5 });
    c.run(1.5);
    expect(guest.world.flag('airlock')).toBe(2);
    expect(guest.mission!.extractionLeft).toBeGreaterThan(60);

    // L'invité est dans le sas : extrait. L'hôte reste dehors et meurt.
    const sas = host.layout.regions[host.layout.extraction.region]!;
    teleportToCell(guest, sas.cells[0]!);
    c.run(4);
    expect(guest.status).toBe('extracted');
    host.sim.damage(500, 'profonde', 'test');
    c.run(4);
    const result = guest.result!;
    expect(result.outcome).toBe('succes');
    expect(result.objectivesDone).toContain('P-MED');
    expect(result.players.find((p) => p.id === 'joueur-2')!.status).toBe('extrait');
    expect(result.players.find((p) => p.id === 'joueur-1')!.status).toBe('mort');
    expect(result.duration).toBeGreaterThan(5);
  });

  it("un client ne peut pas se déclarer extrait sans être dans le sas ouvert", async () => {
    const c = await createCluster(2);
    c.rooms[1]!.send(MSG.FACT, { k: 'extracted' }, 'joueur-1');
    c.run(0.5);
    expect(c.sessions[0]!.players.get('joueur-2')!.status).toBe('playing');
  });
});

describe('charge', () => {
  it('six joueurs pendant 60 s : débit compatible avec Supabase Realtime', async () => {
    const c = await createCluster(6, 'CHARGE');
    const before = c.hub.delivered;
    const channels = c.rooms.map((r) => r.channel as unknown as { sent: number; bytes: number });
    const sent0 = channels.map((ch) => ch.sent);
    const bytes0 = channels.map((ch) => ch.bytes);
    let t = 0;
    const started = performance.now();
    c.run(60, () => {
      t += 0.05;
      c.inputs.forEach((inp, i) => {
        inp.forward = Math.sin(t * 0.5 + i) > 0 ? 1 : 0;
        inp.strafe = Math.cos(t * 0.3 + i);
      });
    });
    const elapsed = performance.now() - started;
    const perSecond = channels.map((ch, i) => (ch.sent - sent0[i]!) / 60);
    const kbPerSecond = channels.map((ch, i) => (ch.bytes - bytes0[i]!) / 60 / 1024);
    // Invités : ~10 messages/s (état du personnage). Hôte : davantage (entités, monde).
    for (const rate of perSecond.slice(1)) expect(rate).toBeLessThan(14);
    expect(perSecond[0]!).toBeLessThan(30);
    expect(perSecond.reduce((a, b) => a + b, 0)).toBeLessThan(100);
    for (const kb of kbPerSecond) expect(kb).toBeLessThan(12);
    expect(c.hub.delivered - before).toBeGreaterThan(1000);
    // Coût de simulation : 6 sessions complètes doivent tourner bien plus vite que le temps réel.
    expect(elapsed).toBeLessThan(30_000);
    // Tout le monde voit toujours tout le monde.
    for (const s of c.sessions) {
      for (const other of c.sessions) {
        if (other === s) continue;
        const p = s.players.get(other.self.id)!;
        expect(Math.hypot(p.x - other.motor.x, p.z - other.motor.z)).toBeLessThan(1.2);
      }
    }
  }, 60_000);
});
