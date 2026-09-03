// The learned lane by USE: on a site with a live scene, the random forest runs in the worker through
// onnxruntime-web and reports a mask area; the U-Net runs on the coarse grid and reports its backend,
// window count and area. Both need the shipped model files under /models (the build refuses nothing
// when they are absent, so this gate skips with a visible reason instead of passing vacuously).
import { expect, test } from '@playwright/test';

import { collectErrors, expectNoErrors, gotoRajo } from './_helpers';

test('the random forest and the U-Net delineate the mine in the browser', async ({ page, request }) => {
  test.setTimeout(420_000);
  const reg = await request.get('/models/registry.json');
  const contentType = reg.headers()['content-type'] ?? '';
  // the SPA fallback answers 200 with index.html for any missing file: only JSON is a registry
  test.skip(!reg.ok() || !contentType.includes('json'), 'no models shipped in this build (models/registry.json missing)');
  const registry = (await reg.json()) as { models: Array<{ method: string; file: string }> };
  const hasRf = registry.models.some((m) => m.method === 'M7');
  const hasUnet = registry.models.some((m) => m.method === 'M8');
  test.skip(!hasRf || !hasUnet, `registry lacks a model: rf=${hasRf} unet=${hasUnet}`);

  const errors = collectErrors(page);
  await gotoRajo(page, '/?site=chuquicamata');
  await page.waitForSelector('[data-testid="map"] canvas', { timeout: 60_000 });
  await expect(page.getByTestId('instrument')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('live-fetch').click();
  await expect(page.getByTestId('live-scene')).toBeVisible({ timeout: 180_000 });
  await page.getByTestId('tab-find').click();
  await expect(page.getByTestId('learned')).toBeVisible();

  // M7: the forest on sixteen features, CPU provider
  await page.getByTestId('rf-run').click();
  await expect(page.getByTestId('learned-run')).toBeVisible({ timeout: 180_000 });
  const rfRun = await page.getByTestId('learned-run').textContent();
  expect(rfRun).toMatch(/M7 \/ wasm/);
  const readout = await page.getByTestId('mask-readout').textContent();
  expect(readout).toMatch(/km2/);
  await expect(page.getByTestId('learned-card')).toContainText(/IoU \d\.\d\d/);
  await expect(page.getByTestId('learned-error')).toHaveCount(0);

  // M8: the U-Net on the coarse grid (the default), whichever backend the browser has
  await page.getByTestId('unet-run').click();
  await expect(page.getByTestId('learned-run')).toContainText(/M8/, { timeout: 300_000 });
  const unetRun = await page.getByTestId('learned-run').textContent();
  expect(unetRun).toMatch(/M8 \/ (webgpu|wasm) \/ [\d.]+ s \/ \d+ windows/);
  const readout2 = await page.getByTestId('mask-readout').textContent();
  expect(readout2).toMatch(/km2/);
  await expect(page.getByTestId('learned-error')).toHaveCount(0);
  expectNoErrors(errors);
});
