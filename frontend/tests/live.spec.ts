// The live lane by USE: on a site, the instrument loads the latest clear Sentinel-2 scene from the public
// archive into the browser, the true-colour composite renders, an index is computed with statistics and a
// histogram, and a classical mask reports an area. This gate needs the public archives to be reachable.
import { expect, test } from '@playwright/test';

import { collectErrors, expectNoErrors, gotoRajo } from './_helpers';

test('the live lane reads a Sentinel-2 scene into the browser and computes an index and a mask', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await gotoRajo(page, '/?site=chuquicamata');
  await page.waitForSelector('[data-testid="map"] canvas', { timeout: 60_000 });
  await expect(page.getByTestId('instrument')).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('live-fetch').click();
  await expect(page.getByTestId('live-scene')).toBeVisible({ timeout: 180_000 });
  const scene = await page.getByTestId('live-scene').textContent();
  expect(scene).toMatch(/\d{4}-\d{2}-\d{2}/);
  expect(scene).toMatch(/tiles/);

  // the composite is the default layer; the live image source must exist on the map
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('comp-tc')).toHaveClass(/on/);

  // an index with statistics and a histogram
  await page.getByTestId('index-select').selectOption('ndvi');
  await expect(page.getByTestId('index-stats')).toBeVisible({ timeout: 60_000 });
  const stats = await page.getByTestId('index-stats').textContent();
  expect(stats).toMatch(/p2 \/ p98/);
  await expect(page.getByTestId('histogram')).toBeVisible();

  // a classical mask with an area in km2 compared with the reference polygons
  await page.getByTestId('tab-find').click();
  await page.getByTestId('otsu-run').click();
  await expect(page.getByTestId('mask-readout')).toBeVisible({ timeout: 60_000 });
  const readout = await page.getByTestId('mask-readout').textContent();
  expect(readout).toMatch(/km2/);
  expectNoErrors(errors);
});
