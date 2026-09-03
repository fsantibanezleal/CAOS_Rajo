// The relief lane by USE: on a site with a baked DEM difference the instrument shows the Relief tab; the
// stats read from dem.json; the delta drape adds its layer to the map (the map declares it); the epoch
// toggle switches the terrain source to the site's Copernicus tiles; two clicks on the map produce a
// profile with a painted chart and stats. Runs against any tree with a dem block.
import { expect, test } from '@playwright/test';

import { collectErrors, expectNoErrors, gotoRajo } from './_helpers';

type MapHandle = { getLayer: (id: string) => unknown; getSource: (id: string) => unknown; getTerrain: () => { source: string } | null };

test('the relief lane drapes the DEM difference, switches the terrain epoch and draws a profile', async ({ page, request }) => {
  test.setTimeout(240_000);
  const cat = await request.get('/data/catalog.json');
  test.skip(!cat.ok(), 'no catalog in this build');
  const catalog = (await cat.json()) as { sites: Array<{ site_id: string; manifest_path: string }> };
  let site: string | null = null;
  let bbox: [number, number, number, number] | null = null;
  for (const s of catalog.sites) {
    const m = await request.get(`/data/${s.manifest_path}`);
    if (!m.ok()) continue;
    const doc = (await m.json()) as { dem: { status?: string; terrain_tiles?: string[] } | null; window: { bbox_wgs84: [number, number, number, number] } };
    if (doc.dem && doc.dem.status === 'ok' && (doc.dem.terrain_tiles?.length ?? 0) > 0) {
      site = s.site_id;
      bbox = doc.window.bbox_wgs84;
      break;
    }
  }
  test.skip(!site, 'no site in this build carries a DEM difference (dem stage not run)');

  const errors = collectErrors(page);
  await gotoRajo(page, `/?site=${site}`);
  await page.waitForSelector('[data-testid="map"] canvas', { timeout: 60_000 });
  await expect
    .poll(() => page.evaluate(() => !!(window as unknown as { __rajoMap?: unknown }).__rajoMap), { message: 'the map exposes __rajoMap after load', timeout: 90_000 })
    .toBe(true);
  await expect(page.getByTestId('tab-relief')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('tab-relief').click();
  await expect(page.getByTestId('relief')).toBeVisible();
  const stats = await page.getByTestId('relief-stats').textContent();
  expect(stats).toMatch(/Mm3|km3/);
  expect(stats).toMatch(/m,/); // the noise floor line

  // the delta drape
  await page.getByTestId('delta-toggle').check();
  await expect
    .poll(() => page.evaluate(() => !!((window as unknown as { __rajoMap?: MapHandle }).__rajoMap?.getLayer('dem-delta-layer'))), { message: 'dem-delta-layer on the map', timeout: 20_000 })
    .toBe(true);

  // the epoch toggle switches the terrain source to the site's Copernicus tiles
  await page.getByTestId('epoch-cop').click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __rajoMap?: MapHandle }).__rajoMap?.getTerrain()?.source ?? null), { message: 'terrain source is terrain-cop', timeout: 20_000 })
    .toBe('terrain-cop');
  await page.getByTestId('epoch-global').click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __rajoMap?: MapHandle }).__rajoMap?.getTerrain()?.source ?? null), { timeout: 20_000 })
    .toBe('terrain');

  // the profile: two clicks on the map canvas, then a painted chart and stats
  await page.getByTestId('profile-pick').click();
  await expect(page.getByTestId('profile-state')).toHaveText(/picking 0\/2/, { timeout: 10_000 });
  // the two points sit inside the baked window (projected through the live camera), so both surfaces
  // answer along the whole line; a click at an arbitrary screen position can land outside the
  // Copernicus tiles on a pitched view (measured on Antamina, 2026-09-03)
  const canvas = page.locator('[data-testid="map"] canvas').first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const [w, s, e, n] = bbox!;
  const pts: [number, number][] = [
    [w + (e - w) * 0.4, s + (n - s) * 0.5],
    [w + (e - w) * 0.6, s + (n - s) * 0.55],
  ];
  const screen = await page.evaluate(
    (p) => p.map((q) => (window as unknown as { __rajoMap: { project: (l: [number, number]) => { x: number; y: number } } }).__rajoMap.project(q)),
    pts,
  );
  await page.mouse.click(box!.x + screen[0]!.x, box!.y + screen[0]!.y);
  await expect(page.getByTestId('profile-state')).toHaveText(/picking 1\/2/, { timeout: 10_000 });
  await page.mouse.click(box!.x + screen[1]!.x, box!.y + screen[1]!.y);
  await expect(page.getByTestId('profile-state')).toHaveText(/sampling|profile \d+ samples/, { timeout: 10_000 });
  await expect(page.getByTestId('profile-error')).toHaveCount(0);
  await expect(page.getByTestId('profile-plot')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('profile-stats')).toBeVisible({ timeout: 60_000 });
  // every sample found a Copernicus tile, so the change statistics are printed
  await expect(page.getByTestId('profile-coverage')).toHaveText(/^200\/200$/);
  await expect(page.getByTestId('profile-stats')).toContainText(/Deepest change/);
  const painted = await page.getByTestId('profile-plot').locator('canvas').first().evaluate((c) => {
    const canvasEl = c as HTMLCanvasElement;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return 0;
    const d = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4 * 61) if (d[i]! > 0) n++;
    return n;
  });
  expect(painted, 'the profile canvas has painted pixels').toBeGreaterThan(50);
  expect(await page.getByTestId('profile-stats').textContent()).toMatch(/km/);
  expectNoErrors(errors);
});
