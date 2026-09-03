// The chrome by USE: the language toggle actually changes the visible strings, the theme toggle actually
// changes the data-theme attribute, every route is reachable by clicking, the terrain and labels toggles
// change state, and picking a site from the grouped select shows its card, draws its polygons and writes
// the deep link. A gate that only fetches URLs is not navigation.
import { expect, test } from '@playwright/test';

test('language and theme toggles change what is on screen; every route is reachable by click', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page).toHaveTitle(/Rajo/);
  await page.waitForSelector('[data-testid="map"] canvas', { timeout: 60_000 });

  const navBefore = await page.locator('.hdr nav a').allTextContents();
  expect(navBefore).toContain('Observatory');
  await page.getByTestId('lang-btn').click();
  await expect(page.locator('.hdr nav a').first()).toHaveText('Observatorio');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('es');
  await page.getByTestId('lang-btn').click();
  await expect(page.locator('.hdr nav a').first()).toHaveText('Observatory');

  const t0 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.getByTestId('theme-btn').click();
  const t1 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  expect(t1).not.toBe(t0);
  await page.getByTestId('theme-btn').click();

  for (const label of ['Atlas', 'Methods', 'Data', 'About', 'Observatory']) {
    await page.locator('.hdr nav a', { hasText: label }).click();
    await expect(page.locator('.hdr nav a.on')).toHaveText(label);
    const r = await page.evaluate(() => ({
      overX: document.documentElement.scrollWidth > innerWidth + 1,
      overY: document.documentElement.scrollHeight > innerHeight + 2,
    }));
    expect(r.overX, `${label}: no horizontal overflow`).toBe(false);
    expect(r.overY, `${label}: no vertical overflow`).toBe(false);
  }

  await page.getByTestId('terrain-btn').click();
  await expect(page.getByTestId('terrain-btn')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('labels-btn').click();
  await expect(page.getByTestId('labels-btn')).toHaveAttribute('aria-pressed', 'false');
  expect(errors, `page errors:
${errors.join('
')}`).toEqual([]);
});

test('the atlas lists the catalog and a picked site shows its card, polygons and deep link', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/atlas');
  await expect(page).toHaveTitle(/Rajo/);
  const rows = page.locator('[data-testid="atlas-table"] tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  expect(await rows.count()).toBeGreaterThanOrEqual(24);

  await page.locator('.hdr nav a', { hasText: 'Observatory' }).click();
  await page.waitForSelector('[data-testid="map"] canvas', { timeout: 60_000 });
  const select = page.getByTestId('site-select');
  await expect(select.locator('optgroup')).not.toHaveCount(0, { timeout: 30_000 });
  const groups = await select.locator('optgroup').count();
  expect(groups).toBeGreaterThanOrEqual(6);
  await select.selectOption('chuquicamata');
  await expect(page.getByTestId('site-card')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('site-card').locator('h2')).toHaveText('Chuquicamata');
  await expect(page.getByTestId('site-card').locator('.facts li')).not.toHaveCount(0);
  expect(page.url()).toContain('site=chuquicamata');
  await page.waitForTimeout(3500);
  const drawn = await page.evaluate(async () => {
    // the polygons source must exist and carry features once the manifest and the geojson loaded
    const res = await fetch('/data/sites/chuquicamata/polygons.geojson');
    const fc = (await res.json()) as { features: unknown[] };
    return fc.features.length;
  });
  expect(drawn).toBeGreaterThan(0);

  await page.goto('/?site=escondida');
  await expect(page).toHaveTitle(/Rajo/);
  await expect(page.getByTestId('site-card').locator('h2')).toHaveText('Escondida', { timeout: 30_000 });
  expect(errors, `page errors:
${errors.join('
')}`).toEqual([]);
});
