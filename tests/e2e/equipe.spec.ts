import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { app, enter, trackErrors, waitForGame } from './helpers';

/** Crée un salon et y fait entrer `n - 1` invités, tous prêts. */
async function lobby(context: BrowserContext, n: number, seed: string): Promise<{ pages: Page[]; code: string }> {
  const pages: Page[] = [];
  const host = await context.newPage();
  pages.push(host);
  await enter(host, '&nom=Joueur1');
  await host.click('#menu-create');
  await host.fill('#room-seed', seed);
  await host.click('#room-create');
  const code = await host.locator('#room-code').innerText();
  for (let i = 2; i <= n; i++) {
    const p = await context.newPage();
    pages.push(p);
    await enter(p, `&nom=Joueur${i}`);
    await p.click('#menu-join');
    await p.fill('#join-code', code);
    await p.click('#join-submit');
    await expect(p.locator('#room-code')).toHaveText(code);
    await p.click('#lobby-ready');
  }
  return { pages, code };
}

test('six joueurs : salon complet, septième refusé, tous en jeu et synchronisés', async ({ context }) => {
  test.setTimeout(600_000);
  const { pages, code } = await lobby(context, 6, 'SIX');
  const errors = pages.flatMap((p) => trackErrors(p));
  const host = pages[0]!;
  await expect(host.locator('.list-item .badge', { hasText: 'prêt' })).toHaveCount(6, { timeout: 30_000 });

  // Un septième joueur est refusé.
  const extra = await context.newPage();
  await enter(extra, '&nom=Joueur7');
  await extra.click('#menu-join');
  await extra.fill('#join-code', code);
  await extra.click('#join-submit');
  await expect(extra.locator('.error')).toContainText('complet', { timeout: 15_000 });
  await extra.close();

  await expect(host.locator('#lobby-start')).toBeEnabled({ timeout: 15_000 });
  await host.click('#lobby-start');
  await Promise.all(pages.map((p) => waitForGame(p)));

  // Chaque client connaît les six joueurs et reçoit les entités de l'hôte.
  for (const p of pages) {
    expect(await app(p, 'a.session.players.size')).toBe(6);
    await expect.poll(() => app<number>(p, 'a.session.entities.size'), { timeout: 120_000 }).toBeGreaterThanOrEqual(8);
  }
  // Tout le monde se voit à sa place (points d'apparition distincts autour du hall).
  const last = pages[5]!;
  const lastId = await app<string>(last, 'a.session.self.id');
  const pos = await app<{ x: number; z: number }>(last, '({ x: a.session.motor.x, z: a.session.motor.z })');
  await expect
    .poll(async () => {
      const seen = await app<{ x: number; z: number }>(host, `(() => { const p = a.session.players.get(${JSON.stringify(lastId)}); return { x: p.x, z: p.z }; })()`);
      return Math.hypot(seen.x - pos.x, seen.z - pos.z);
    }, { timeout: 120_000 })
    .toBeLessThan(0.5);
  const spawns = await Promise.all(pages.map((p) => app<string>(p, '`${a.session.motor.x.toFixed(1)}:${a.session.motor.z.toFixed(1)}`')));
  expect(new Set(spawns).size).toBe(6);
  expect(errors).toEqual([]);
});

test('reconnexion : un invité recharge la page et retrouve la partie en cours', async ({ context }) => {
  const { pages, code } = await lobby(context, 2, 'RETOUR');
  const [host, guest] = pages as [Page, Page];
  await host.click('#lobby-start');
  await Promise.all([waitForGame(host), waitForGame(guest)]);
  const guestId = await app<string>(guest, 'a.session.self.id');

  // L'hôte ouvre une porte pendant l'absence de l'invité.
  await guest.reload();
  const door = await app<number>(host, "a.session.layout.doors.find((d) => d.kind === 'door' && !d.lock).id");
  await host.evaluate((id) => (window as unknown as { nocturne: { session: { world: { setDoor(id: number, p: object): void } } } }).nocturne.session.world.setDoor(id, { pos: 2, locked: false }), door);

  // Même onglet, même identité : le salon le reconnaît comme membre de l'expédition.
  await guest.click('#enter');
  await guest.click('#menu-join');
  await guest.fill('#join-code', code);
  await guest.click('#join-submit');
  await waitForGame(guest);
  expect(await app(guest, 'a.session.self.id')).toBe(guestId);
  await expect.poll(() => app<number>(guest, `a.session.world.doors[${door}].pos`), { timeout: 120_000 }).toBe(2);
  await expect.poll(() => app<boolean>(host, `a.session.players.get(${JSON.stringify(guestId)}).connected`), { timeout: 120_000 }).toBe(true);
});

test('voix : deux clients établissent une liaison WebRTC et signalent qui parle', async ({ context }) => {
  await context.grantPermissions(['microphone']);
  const { pages } = await lobby(context, 2, 'VOIX');
  const [a, b] = pages as [Page, Page];
  await a.click('#lobby-voice');
  await b.click('#lobby-voice');
  await expect(a.locator('#lobby-voice')).toHaveText('Voix active', { timeout: 30_000 });
  await expect(b.locator('#lobby-voice')).toHaveText('Voix active', { timeout: 30_000 });
  await expect.poll(() => app<number>(a, 'a.voice.connectedPeers()'), { timeout: 60_000 }).toBe(1);
  await expect.poll(() => app<number>(b, 'a.voice.connectedPeers()'), { timeout: 60_000 }).toBe(1);

  // Indicateur de parole : visible chez l'autre joueur, absent une fois le micro coupé.
  await a.evaluate(() => (window as unknown as { nocturne: { voice: { setTalking(ch: string | null): void } } }).nocturne.voice.setTalking('prox'));
  await expect(b.locator('.badge', { hasText: 'parle' })).toBeVisible({ timeout: 20_000 });
  // Le flux audio arrive réellement chez le destinataire.
  await expect
    .poll(() => app<boolean>(b, "Array.from(a.voice.peers.values()).some((p) => p.source !== null && p.sink && p.sink.srcObject && p.sink.srcObject.getAudioTracks().length > 0)"), { timeout: 30_000 })
    .toBe(true);
  await a.evaluate(() => (window as unknown as { nocturne: { voice: { setTalking(ch: string | null): void } } }).nocturne.voice.setTalking(null));
  await expect(b.locator('.badge', { hasText: 'parle' })).toHaveCount(0, { timeout: 20_000 });

  // Désactivation : la liaison est fermée proprement.
  await a.click('#lobby-voice');
  await expect(a.locator('#lobby-voice')).toHaveText('Activer la voix');
  await expect.poll(() => app<number>(a, 'a.voice.connectedPeers()')).toBe(0);
});
