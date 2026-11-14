import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OBJECTIVES } from '../../src/missions/objectives';
import type { ExpeditionResult } from '../../src/network/protocol';
import { ACHIEVEMENTS, UNLOCKS, applyResult, computeXp, emptyProfile, isUnlocked, levelForXp, xpForLevel } from '../../src/persistence/progression';
import { LocalProfileStore } from '../../src/persistence/store';
import { DOCUMENTS } from '../../src/world/lore';
import { SECTORS } from '../../src/world/sectors';

const sql = readFileSync(new URL('../../supabase/migrations/0001_nocturne.sql', import.meta.url), 'utf8');

function result(patch: Partial<ExpeditionResult> = {}): ExpeditionResult {
  return {
    sessionId: 's1',
    seed: 'X',
    outcome: 'succes',
    duration: 1200,
    primary: 'P-CORE',
    objectivesDone: ['P-CORE', 'S-AUX', 'S-RELAY', 'S-DOCS-5'],
    objectivesFailed: [],
    documents: ['acc-02', 'med-01'],
    creatures: ['echo'],
    players: [
      { id: 'a', name: 'A', status: 'extrait' },
      { id: 'b', name: 'B', status: 'mort' },
    ],
    ...patch,
  };
}

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

describe('progression', () => {
  it('courbe de niveaux croissante et cohérente', () => {
    expect(levelForXp(0)).toBe(1);
    for (let l = 2; l < 30; l++) {
      expect(xpForLevel(l)).toBeGreaterThan(xpForLevel(l - 1));
      expect(levelForXp(xpForLevel(l))).toBe(l);
      expect(levelForXp(xpForLevel(l) - 1)).toBe(l - 1);
    }
  });

  it("calcule l'expérience comme le serveur", () => {
    // Valeurs identiques aux assertions de supabase/tests/01_scenarios.sql.
    expect(computeXp(result(), 'a')).toBe(1044);
    expect(computeXp(result(), 'b')).toBe(534);
    expect(computeXp(result({ outcome: 'echec', objectivesDone: ['S-MARK'], documents: [], players: [{ id: 'a', name: 'A', status: 'mort' }] }), 'a')).toBe(110);
    expect(computeXp(result({ duration: 60 }), 'a')).toBe(40);
    expect(computeXp(result({ players: [{ id: 'a', name: 'A', status: 'abandon' }] }), 'a')).toBe(0);
    expect(computeXp(result(), 'inconnu')).toBe(0);
  });

  it('le barème SQL est identique au catalogue des objectifs', () => {
    const rows = Array.from(sql.matchAll(/\('([PS]-[A-Z0-9-]+)', '(principal|secondaire)', (\d+)\)/g)).map((m) => ({ id: m[1], kind: m[2], xp: Number(m[3]) }));
    expect(rows).toHaveLength(OBJECTIVES.length);
    for (const o of OBJECTIVES) {
      expect(rows.find((r) => r.id === o.id), o.id).toEqual({ id: o.id, kind: o.kind, xp: o.xp });
    }
  });

  it('les déblocages SQL sont identiques à ceux du client', () => {
    const rows = Array.from(sql.matchAll(/\('(titre|tenue)', '((?:[^']|'')+)', (null|\d+), (null|'[a-z_]+')\)/g)).map((m) => ({
      kind: m[1],
      value: m[2]!.replace(/''/g, "'"),
      level: m[3] === 'null' ? undefined : Number(m[3]),
      achievement: m[4] === 'null' ? undefined : m[4]!.slice(1, -1),
    }));
    expect(rows).toHaveLength(UNLOCKS.length);
    for (const u of UNLOCKS) {
      expect(rows.find((r) => r.kind === u.kind && r.value === u.value), u.id).toEqual({ kind: u.kind, value: u.value, level: u.level, achievement: u.achievement });
    }
    for (const a of ACHIEVEMENTS) expect(sql, a.id).toContain(`'${a.id}'`);
    // Le filtre SQL des documents accepte tous les identifiants réels.
    for (const d of DOCUMENTS) expect(d.id).toMatch(/^[a-z]{3}-[0-9]{2}$/);
    expect(DOCUMENTS).toHaveLength(24);
    expect(new Set(DOCUMENTS.map((d) => d.sector)).size).toBe(SECTORS.length);
  });

  it('applique un résultat : statistiques, documents, créatures, succès, niveau', () => {
    const p0 = emptyProfile('a', 'A', false);
    const r = result();
    const { profile, newAchievements, leveledUp } = applyResult(p0, r, computeXp(r, 'a'));
    expect(profile.xp).toBe(1044);
    expect(profile.level).toBe(3);
    expect(leveledUp).toBe(true);
    expect(profile.expeditions).toBe(1);
    expect(profile.successes).toBe(1);
    expect(profile.documents).toEqual(['acc-02', 'med-01']);
    expect(profile.creatures).toEqual(['echo']);
    expect(newAchievements).toEqual(['premiere_sortie', 'noyau']);
    // Profil d'origine intact.
    expect(p0.xp).toBe(0);
    const dead = applyResult(emptyProfile('b', 'B', false), r, computeXp(r, 'b')).profile;
    expect(dead.deaths).toBe(1);
    expect(dead.failures).toBe(1);
    expect(dead.achievements).toEqual([]);
  });

  it('les déblocages sont cosmétiques et conditionnés', () => {
    const p = emptyProfile('a', 'A', false);
    const available = UNLOCKS.filter((u) => isUnlocked(p, u)).map((u) => u.id);
    expect(available).toEqual(['t-recrue', 'c-gris']);
    p.level = 12;
    p.achievements = ['noyau'];
    expect(UNLOCKS.filter((u) => isUnlocked(p, u)).length).toBeGreaterThan(10);
    for (const u of UNLOCKS) expect(['titre', 'tenue']).toContain(u.kind);
  });
});

describe('profil local', () => {
  it('crée un profil, le conserve et borne le nom', async () => {
    const storage = memoryStorage();
    const store = new LocalProfileStore(storage);
    const p = await store.load();
    expect(p.id.length).toBeGreaterThan(10);
    expect((await store.load()).id).toBe(p.id);
    const renamed = await store.saveIdentity({ name: '   Un nom beaucoup trop long pour tenir   ' });
    expect(renamed.name.length).toBeLessThanOrEqual(20);
    expect((await new LocalProfileStore(storage).load()).name).toBe(renamed.name);
  });

  it("enregistre un résultat une seule fois", async () => {
    const store = new LocalProfileStore(memoryStorage());
    const me = await store.load();
    const r = result({ players: [{ id: me.id, name: me.name, status: 'extrait' }] });
    const first = await store.recordResult(r);
    expect(first.xp).toBe(1044);
    expect(first.profile.expeditions).toBe(1);
    const again = await store.recordResult(r);
    expect(again.xp).toBe(0);
    expect((await store.load()).xp).toBe(1044);
  });

  it('survit à un stockage corrompu', async () => {
    const storage = memoryStorage();
    storage.setItem('nocturne.profil', '{pas du json');
    const p = await new LocalProfileStore(storage).load();
    expect(p.level).toBe(1);
  });
});
