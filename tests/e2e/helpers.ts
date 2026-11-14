import { expect, type Page } from '@playwright/test';

/** Erreurs console et exceptions relevées pendant un test (aucune n'est tolérée). */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`exception : ${String(e)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console : ${m.text()}`);
  });
  return errors;
}

/** Ouvre le jeu (qualité faible : le rendu logiciel des tests est lent) et passe l'écran de lancement. */
export async function enter(page: Page, query = ''): Promise<void> {
  await page.goto(`/?q=faible&local=1${query}`);
  await page.click('#enter');
  // Avec auto=solo, le menu est aussitôt remplacé par le chargement de la partie.
  if (!query.includes('auto=')) await expect(page.locator('#menu-solo')).toBeVisible();
}

/** Lit une valeur dans l'application (champs privés compris). */
export function app<T>(page: Page, expr: string): Promise<T> {
  return page.evaluate(`(() => { const a = window.nocturne; return ${expr}; })()`) as Promise<T>;
}

export async function waitForGame(page: Page): Promise<void> {
  await expect(page.locator('.hud')).toBeVisible({ timeout: 150_000 });
  await expect.poll(() => app<boolean>(page, 'a.inGame && a.session !== null'), { timeout: 30_000 }).toBe(true);
}

/** Capture la souris en cliquant dans la scène. */
export async function lockPointer(page: Page): Promise<void> {
  await page.mouse.click(400, 225);
  await expect.poll(() => app<boolean>(page, 'a.input.locked'), { timeout: 20_000 }).toBe(true);
}
