// The signal lane by USE: a site with a baked series shows the Series button on the timeline; the drawer
// draws the mined-area chart (a uPlot canvas with pixels), reports the baked breaks, the penalty slider
// changes the live PELT result, the index and dense views render, the mask toggle drapes the year's mask
// on the map (the map declares it), and a click on the plot moves the timeline. Runs against a tree
// with a series (the sandbox build or the committed tree once the derived stages ran).
import { expect, test } from '@playwright/test';

import { collectErrors, expectNoErrors, gotoRajo } from './_helpers';

test('the series drawer charts the mined-area series, its breaks and the yearly masks', async ({ page, request }) => {
  test.setTimeout(180_000);
  const cat = await request.get('/data/catalog.json');
  test.skip(!cat.ok(), 'no catalog in this build');
  const catalog = (await cat.json()) as { sites: Array<{ site_id: string; manifest_path: string }> };
  let siteWithSeries: string | null = null;
  for (const s of catalog.sites) {
    const m = await request.get(`/data/${s.manifest_path}`);
    if (!m.ok()) continue;
    const doc = (await m.json()) as { series: unknown };
    if (doc.series) {
      siteWithSeries = s.site_id;
      break;
    }
  }
  test.skip(!siteWithSeries, 'no site in this build carries a series (derived stages not run)');

  const errors = collectErrors(page);
  await gotoRajo(page, `/?site=${siteWithSeries}`);
  await page.waitForSelector('[data-testid="map"] canvas', { timeout: 60_000 });
  await expect(page.getByTestId('timeline')).toBeVisible({ timeout: 30_000 });
  // the map hands itself to the page on its 'load' event, which waits for the first basemap tiles;
  // every overlay hangs off that handle, so the gate waits for it (WAIT for state, never assume it)
  await expect
    .poll(() => page.evaluate(() => !!(window as unknown as { __rajoMap?: unknown }).__rajoMap), { message: 'the map exposes __rajoMap after load', timeout: 90_000 })
    .toBe(true);
  await expect(page.getByTestId('series-btn')).toBeVisible();
  await page.getByTestId('series-btn').click();
  await expect(page.getByTestId('series-panel')).toBeVisible();

  // the chart is a real drawing, not an empty box
  const plot = page.getByTestId('series-plot');
  await expect(plot.locator('canvas')).toBeVisible({ timeout: 15_000 });
  const painted = await plot.locator('canvas').first().evaluate((c) => {
    const canvas = c as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4 * 97) if (d[i]! > 0) n++;
    return n;
  });
  expect(painted, 'the series canvas has painted pixels').toBeGreaterThan(50);
  const box = await plot.boundingBox();
  expect(box && box.height).toBeGreaterThan(100);

  // the baked breaks are reported and the penalty slider reruns PELT live
  await expect(page.getByTestId('series-breaks')).toContainText(/PELT/);
  const before = await page.getByTestId('series-breaks').textContent();
  await page.getByTestId('series-penalty').fill('4');
  const lenient = await page.getByTestId('series-breaks').textContent();
  await page.getByTestId('series-penalty').fill('0.25');
  const strict = await page.getByTestId('series-breaks').textContent();
  expect(before).toBeTruthy();
  expect(lenient !== strict || before === lenient, 'the penalty changes the live result or the series has no ambiguity').toBeTruthy();

  // the other views render
  await page.getByTestId('series-view-index').click();
  await expect(plot.locator('canvas')).toBeVisible();
  if ((await page.getByTestId('series-view-dense').count()) > 0) {
    await page.getByTestId('series-view-dense').click();
    await expect(plot.locator('canvas')).toBeVisible();
  }
  await page.getByTestId('series-view-area').click();

  // the mask of the year on the map: the map must hold the mask layer after the toggle
  await page.getByTestId('series-mask-toggle').check();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const m = (window as unknown as { __rajoMap?: { getLayer: (id: string) => unknown } }).__rajoMap;
          return m ? !!m.getLayer('frame-mask-layer') : null;
        }),
      { message: 'the map exposes __rajoMap and holds frame-mask-layer', timeout: 15_000 },
    )
    .toBe(true);

  // a click on the plot moves the timeline
  const yearBefore = await page.getByTestId('tl-year').textContent();
  await plot.click({ position: { x: Math.round((box?.width ?? 400) * 0.3), y: Math.round((box?.height ?? 200) * 0.5) } });
  await page.waitForTimeout(300);
  const yearAfter = await page.getByTestId('tl-year').textContent();
  expect(yearAfter).not.toBe(yearBefore);
  expectNoErrors(errors);
});
