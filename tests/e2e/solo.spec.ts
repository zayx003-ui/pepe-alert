import { expect, test } from '@playwright/test';
import { app, enter, lockPointer, trackErrors, waitForGame } from './helpers';

test('expédition solo : déplacement, lampe, inventaire, carte, pause, résultat', async ({ page }) => {
  const errors = trackErrors(page);
  await enter(page);
  await page.click('#menu-solo');
  await page.click('#lobby-start');
  await waitForGame(page);

  // La partie tourne : mission tirée, entités présentes, joueur au hall d'accueil.
  expect(await app(page, 'a.session.mission.objectives.length')).toBeGreaterThanOrEqual(3);
  expect(await app(page, 'a.session.entities.size')).toBeGreaterThanOrEqual(8);
  await expect(page.locator('.status-line')).toContainText('ACCUEIL');
  await expect(page.locator('.objectives')).toContainText('Objectif');

  // Capture de la souris puis déplacement réel au clavier (position physique : Z sur AZERTY).
  await lockPointer(page);
  const start = await app<{ x: number; z: number }>(page, '({ x: a.session.motor.x, z: a.session.motor.z })');
  await page.keyboard.down('KeyW');
  await expect.poll(async () => {
    const p = await app<{ x: number; z: number }>(page, '({ x: a.session.motor.x, z: a.session.motor.z })');
    return Math.hypot(p.x - start.x, p.z - start.z);
  }, { timeout: 60_000 }).toBeGreaterThan(0.5);
  await page.keyboard.up('KeyW');

  // La souris fait tourner la vue.
  const yaw = await app<number>(page, 'a.session.motor.yaw');
  await page.mouse.move(500, 225);
  await page.mouse.move(560, 225);
  await expect.poll(() => app<number>(page, 'a.session.motor.yaw'), { timeout: 20_000 }).not.toBe(yaw);

  // Lampe torche.
  expect(await app(page, "a.session.inventory.find('lampe').on")).toBe(false);
  await page.keyboard.press('KeyF');
  await expect.poll(() => app<boolean>(page, "a.session.inventory.find('lampe').on"), { timeout: 20_000 }).toBe(true);

  // Accroupissement.
  await page.keyboard.down('KeyC');
  await expect.poll(() => app<boolean>(page, 'a.session.motor.crouching'), { timeout: 20_000 }).toBe(true);
  await page.keyboard.up('KeyC');

  // Inventaire, carte, documents.
  await page.keyboard.press('Tab');
  await expect(page.locator('.inv-grid')).toBeVisible();
  await expect(page.locator('.inv-cell').first()).toContainText('Lampe torche');
  await page.keyboard.press('KeyM');
  await expect(page.locator('.map-wrap canvas')).toBeVisible();
  await page.keyboard.press('KeyJ');
  await expect(page.locator('.panel')).toContainText('Aucun document récupéré');
  await page.getByRole('button', { name: 'Fermer' }).click();
  await expect(page.locator('.inv-grid')).toHaveCount(0);

  // Discussion écrite de proximité.
  await page.keyboard.press('Enter');
  await page.locator('.chat-input input').fill('Il y a quelqu’un ?');
  await page.keyboard.press('Enter');
  await expect(page.locator('.chat-line')).toContainText('Il y a quelqu’un ?');

  // Pause puis abandon : l'expédition se clôt sur un échec enregistré dans le profil.
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-resume')).toBeVisible({ timeout: 20_000 });
  await page.click('#pause-abandon');
  await expect(page.locator('#result-title')).toHaveText('Expédition perdue', { timeout: 60_000 });
  await expect(page.locator('#result-xp')).toHaveText(/^\+\d+$/, { timeout: 20_000 });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('nocturne.profil')!));
  expect(stored.expeditions).toBe(1);
  expect(stored.failures).toBe(1);

  // Retour au salon puis seconde expédition dans la foulée, sur une nouvelle graine.
  const firstSeed = await page.locator('.panel .muted').first().innerText();
  await page.click('#result-lobby');
  await expect(page.locator('#lobby-start')).toBeEnabled();
  await page.click('#lobby-start');
  await waitForGame(page);
  const secondSeed = await app<string>(page, 'a.session.seed');
  expect(firstSeed).not.toContain(secondSeed);
  expect(await app(page, 'a.session.status')).toBe('playing');
  expect(await app(page, 'a.session.sim.health')).toBe(100);
  expect(errors).toEqual([]);
});

test('une graine donnée reproduit la même carte dans le navigateur', async ({ page }) => {
  await enter(page, '&auto=solo&seed=REPRO');
  await waitForGame(page);
  const a1 = await app<number[]>(page, '[a.session.layout.doors.length, a.session.layout.props.length, a.session.layout.spawn.x, a.session.layout.spawn.z]');
  await page.reload();
  await page.click('#enter');
  await waitForGame(page);
  const a2 = await app<number[]>(page, '[a.session.layout.doors.length, a.session.layout.props.length, a.session.layout.spawn.x, a.session.layout.spawn.z]');
  expect(a2).toEqual(a1);
  expect(await app(page, 'a.session.seed')).toBe('REPRO');
});
