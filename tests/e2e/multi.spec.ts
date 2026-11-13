import { expect, test, type Page } from '@playwright/test';
import { app, enter, trackErrors, waitForGame } from './helpers';

/** Deux onglets du même navigateur : salon local, lancement, synchronisation en jeu. */
test('multijoueur à deux clients : salon, états, synchronisation, départ de l’hôte', async ({ context }) => {
  const host: Page = await context.newPage();
  const guest: Page = await context.newPage();
  const errors = [...trackErrors(host), ...trackErrors(guest)];

  await enter(host, '&nom=Alice');
  await host.click('#menu-create');
  await host.fill('#room-seed', 'DUO');
  await host.selectOption('#room-objective', 'P-MED');
  await host.click('#room-create');
  const code = await host.locator('#room-code').innerText();

  await enter(guest, '&nom=Bruno');
  await guest.click('#menu-join');
  // Le salon public apparaît dans la recherche.
  await expect(guest.locator('#room-list')).toContainText('Alice', { timeout: 15_000 });
  await guest.fill('#join-code', code);
  await guest.click('#join-submit');
  await expect(guest.locator('#room-code')).toHaveText(code);

  // Chacun voit l'autre ; l'hôte ne peut lancer que lorsque l'invité est prêt.
  await expect(host.locator('.list-item', { hasText: 'Bruno' })).toBeVisible({ timeout: 15_000 });
  await expect(guest.locator('.list-item', { hasText: 'Alice' })).toContainText('hôte');
  await expect(host.locator('#lobby-start')).toBeDisabled();
  await guest.click('#lobby-ready');
  await expect(host.locator('#lobby-start')).toBeEnabled({ timeout: 15_000 });

  // Discussion du lobby.
  await guest.fill('#lobby-chat', 'Prêt à descendre.');
  await guest.press('#lobby-chat', 'Enter');
  await expect(host.locator('.list', { hasText: 'Prêt à descendre.' })).toBeVisible({ timeout: 15_000 });

  await host.click('#lobby-start');
  await Promise.all([waitForGame(host), waitForGame(guest)]);

  // Même carte, même mission, entités répliquées chez l'invité.
  expect(await app(guest, 'a.session.seed')).toBe('DUO');
  expect(await app(guest, 'a.session.isHost')).toBe(false);
  expect(await app(host, 'a.session.isHost')).toBe(true);
  await expect.poll(() => app<string>(guest, 'a.session.mission?.objectives[0]?.id ?? ""'), { timeout: 60_000 }).toBe('P-MED');
  await expect.poll(() => app<number>(guest, 'a.session.entities.size'), { timeout: 60_000 }).toBeGreaterThanOrEqual(8);

  // Déplacement de l'hôte visible chez l'invité.
  const hostId = await app<string>(host, 'a.session.self.id');
  await host.evaluate(() => {
    const a = (window as unknown as { nocturne: { session: { motor: { x: number; teleport(x: number, y: number, z: number): void; y: number; z: number } } } }).nocturne;
    a.session.motor.teleport(a.session.motor.x + 1.5, a.session.motor.y, a.session.motor.z);
  });
  const hx = await app<number>(host, 'a.session.motor.x');
  await expect.poll(async () => Math.abs((await app<number>(guest, `a.session.players.get(${JSON.stringify(hostId)}).x`)) - hx), { timeout: 60_000 }).toBeLessThan(0.3);

  // Action de l'invité validée par l'hôte : une porte s'ouvre chez les deux.
  const door = await app<number>(guest, `(() => {
    const s = a.session; const region = s.world.grid.regionAt(s.motor.x, s.motor.z);
    const d = s.layout.doors.find((x) => x.kind === 'door' && !x.lock && (x.a === region || x.b === region) && s.world.doors[x.id].pos === 0 && !s.world.doors[x.id].locked);
    return d ? d.id : -1; })()`);
  if (door >= 0) {
    await guest.evaluate((id) => {
      const a = (window as unknown as { nocturne: { session: { layout: { doors: { cell: number; dir: number }[] }; motor: { teleport(x: number, y: number, z: number): void; y: number }; perform(t: unknown, action: string): boolean } } }).nocturne;
      const d = a.session.layout.doors[id]!;
      const cx = (d.cell % 80) * 2 + 1;
      const cz = Math.floor(d.cell / 80) * 2 + 1;
      a.session.motor.teleport(cx, a.session.motor.y, cz);
    }, door);
    await guest.waitForTimeout(1500);
    await guest.evaluate((id) => (window as unknown as { nocturne: { session: { perform(t: unknown, action: string): boolean } } }).nocturne.session.perform({ t: 'door', id }, 'open'), door);
    await expect.poll(() => app<number>(host, `a.session.world.doors[${door}].pos`), { timeout: 60_000 }).toBe(2);
    await expect.poll(() => app<number>(guest, `a.session.world.doors[${door}].pos`), { timeout: 60_000 }).toBe(2);
  }

  // L'hôte ferme son onglet : l'invité reprend l'autorité et la partie continue.
  await host.close();
  await expect.poll(() => app<boolean>(guest, 'a.session.isHost && a.session.host !== null'), { timeout: 120_000 }).toBe(true);
  expect(await app(guest, 'a.session.host.ai.agents.length')).toBeGreaterThanOrEqual(8);
  expect(await app(guest, 'a.session.mission.objectives[0].id')).toBe('P-MED');
  expect(errors).toEqual([]);
});
