import { GameSession, emptyInput, type FrameInput } from '../../src/game/session';
import { RoomSession } from '../../src/network/room';
import { MemoryHub, MemoryTransport } from '../../src/network/transport';
import { cellCenterX, cellCenterZ } from '../../src/world/types';

export interface Cluster {
  hub: MemoryHub;
  rooms: RoomSession[];
  sessions: GameSession[];
  inputs: FrameInput[];
  /** Avance tout le monde de `seconds` (pas de 50 ms). */
  run(seconds: number, each?: (t: number) => void): void;
  /** Retire un joueur de la boucle (fermeture brutale de l'onglet). */
  kill(index: number): void;
}

export const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `joueur-${i + 1}`);

/** Crée un salon en mémoire avec n joueurs et lance l'expédition. */
export async function createCluster(n: number, seed = 'GRAPPE', objective = ''): Promise<Cluster> {
  const hub = new MemoryHub();
  const now = (): number => hub.now;
  const rooms: RoomSession[] = [];
  const host = await RoomSession.create(new MemoryTransport(hub), { id: 'joueur-1', name: 'Hôte', title: '', color: '#c33' }, { seed, objective }, now);
  rooms.push(host);
  for (let i = 1; i < n; i++) {
    rooms.push(await RoomSession.join(new MemoryTransport(hub), host.code, { id: `joueur-${i + 1}`, name: `Joueur ${i + 1}`, title: '', color: '#3c3' }, now));
  }
  hub.advance(10);
  for (const r of rooms.slice(1)) r.setReady(true);
  hub.advance(10);
  const sessions: GameSession[] = new Array<GameSession>(n);
  rooms.forEach((room, i) => {
    room.events.on('start', (payload) => {
      const session = new GameSession({
        seed: payload.seed,
        sessionId: payload.sessionId,
        self: room.self,
        roster: payload.roster,
        hostId: payload.hostId,
        objective: payload.objective,
        link: room,
      });
      sessions[i] = session;
      room.events.on('message', (m) => session.receive(m));
      room.events.on('host', (id) => session.setHost(id));
      room.events.on('status', (st) => {
        if (st === 'connected') session.requestSync();
      });
      room.events.on('members', (members) => {
        for (const m of members) session.setConnected(m.id, m.state !== 'disconnected');
      });
      room.markLoaded();
    });
  });
  if (!host.start('session-test')) throw new Error('lancement refusé');
  hub.advance(10);
  const inputs = sessions.map(() => emptyInput());
  const dead = new Set<number>();
  const cluster: Cluster = {
    hub,
    rooms,
    sessions,
    inputs,
    run(seconds, each) {
      const dt = 0.05;
      for (let t = 0; t < seconds; t += dt) {
        each?.(t);
        hub.advance(dt * 1000);
        for (let i = 0; i < sessions.length; i++) {
          if (dead.has(i)) continue;
          rooms[i]!.tick();
          sessions[i]!.update(dt, inputs[i]!);
        }
      }
    },
    kill(index) {
      dead.add(index);
      hub.setOnline(rooms[index]!.code, rooms[index]!.self.id, false);
    },
  };
  return cluster;
}

/** Place un joueur au centre d'une cellule. */
export function teleportToCell(session: GameSession, cell: number, yaw = 0): void {
  const x = cellCenterX(cell);
  const z = cellCenterZ(cell);
  session.motor.teleport(x, session.world.grid.heightAt(x, z), z, yaw);
}

/** Session solo, sans réseau. */
export function soloSession(seed = 'SOLO', objective = ''): GameSession {
  const self = { id: 'solo', name: 'Solo', title: '', color: '#888' };
  return new GameSession({ seed, sessionId: 'solo-test', self, roster: [{ ...self, loadout: ['lampe', 'radio'] }], hostId: 'solo', objective, link: null });
}

/** Identifiants de n portes simples, non verrouillées, mises en position fermée chez l'hôte. */
export function closedDoors(host: GameSession, n: number): number[] {
  const out: number[] = [];
  for (const d of host.layout.doors) {
    if (d.kind !== 'door' || d.lock) continue;
    host.world.setDoor(d.id, { pos: 0, locked: false });
    out.push(d.id);
    if (out.length >= n) break;
  }
  return out;
}
