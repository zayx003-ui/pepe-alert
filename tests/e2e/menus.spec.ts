import { expect, test } from '@playwright/test';
import { enter, trackErrors } from './helpers';

test('lancement, menu principal et écrans hors partie', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/?local=1');
  await expect(page.locator('h1.title')).toHaveText('NOCTURNE');
  await expect(page.locator('.corner').first()).toContainText('Mode local');
  await page.click('#enter');
  await expect(page.locator('#menu-solo')).toBeVisible();

  // Profil : le nom se modifie et persiste.
  await page.click('#menu-profile');
  await page.fill('#profile-name', 'Testeuse');
  await page.click('#profile-save');
  await expect(page.locator('.error')).toHaveText('Profil enregistré.');
  await page.getByRole('button', { name: 'Retour' }).click();
  await expect(page.locator('.corner').first()).toContainText('Testeuse');

  // Archives : quatre onglets alimentés par le contenu réel.
  await page.click('#menu-archives');
  await expect(page.locator('.list-item')).toHaveCount(24);
  await page.getByRole('button', { name: 'Bestiaire' }).click();
  await expect(page.locator('h3')).toHaveCount(6);
  await page.getByRole('button', { name: 'Objectifs' }).click();
  await expect(page.locator('.stat')).toHaveCount(30);
  await page.click('#archives-back');

  // Paramètres : reconfiguration d'une touche et persistance.
  await page.click('#menu-settings');
  const row = page.locator('.stat', { hasText: 'Lampe torche' });
  await row.locator('button').click();
  await expect(row.locator('button')).toHaveText('Appuyez sur une touche…');
  await page.keyboard.press('KeyL');
  await expect(row.locator('button')).toHaveText('L');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nocturne.reglages')!).keys.lampe)).toBe('KeyL');
  await page.click('#settings-back');

  // Compte : sans Supabase, l'écran l'explique au lieu de proposer un faux formulaire.
  await page.click('#menu-account');
  await expect(page.locator('.notice-box')).toContainText("n'est relié à aucun projet Supabase");
  await expect(page.locator('#auth-submit')).toHaveCount(0);
  await page.getByRole('button', { name: 'Retour' }).click();

  // Recherche de salon : liste vide, code inconnu refusé.
  await page.click('#menu-join');
  await expect(page.locator('#room-list')).toContainText('Aucun salon public');
  await page.fill('#join-code', 'ZZZZZ');
  await page.click('#join-submit');
  await expect(page.locator('.error')).toContainText('introuvable');
  await page.getByRole('button', { name: 'Retour' }).click();

  // Création de salon puis sélection d'équipement sous budget.
  await page.click('#menu-create');
  await page.fill('#room-seed', 'menus');
  await page.click('#room-create');
  await expect(page.locator('#room-code')).toHaveText(/^[A-Z2-9]{5}$/);
  await expect(page.locator('#lobby-start')).toBeEnabled();
  await page.click('#lobby-loadout');
  await page.click('#loadout-medkit');
  await page.click('#loadout-outils');
  await page.click('#loadout-radio');
  await expect(page.locator('#loadout-detecteur_mouvement')).toBeDisabled();
  await page.click('#loadout-done');
  await expect(page.locator('.list-item').first()).toContainText('Trousse médicale');
  await page.click('#lobby-leave');
  await expect(page.locator('#menu-solo')).toBeVisible();
  expect(errors).toEqual([]);
});

test('le build de production ne référence aucune ressource externe', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.hostname !== '127.0.0.1') external.push(r.url());
  });
  await enter(page);
  await page.waitForTimeout(500);
  expect(external).toEqual([]);
});
