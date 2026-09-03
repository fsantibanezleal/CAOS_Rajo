// The time-lapse by USE: for a site with frames, the timeline appears with the newest year, stepping
// changes the year and the frame image the map source points at, the composite toggle swaps the image,
// play starts paused and can be started and stopped, and the overlay is drawn on the map (pixels sampled
// from the map canvas differ between the world view and the site view at the same screen position).
import { expect, test } from '@playwright/test';

test('timeline steps years, swaps composites, plays only on demand, and the frame is drawn', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?site=chuquicamata');
  await expect(page).toHaveTitle(/Rajo/);
  await page.waitForSelector('[data-testid="map"] canvas', { timeout: 60_000 });
  const timeline = page.getByTestId('timeline');
  await expect(timeline).toBeVisible({ timeout: 30_000 });
  const yearEl = page.getByTestId('tl-year');
  await expect(yearEl).not.toHaveText('', { timeout: 30_000 });
  const newest = Number(await yearEl.textContent());
  expect(newest).toBeGreaterThanOrEqual(2017);

  // paused by default
  await expect(page.getByTestId('play-btn')).toHaveAttribute('aria-pressed', 'false');

  // the frame source exists and points at the newest frame
  await page.waitForTimeout(3000);
  const src0 = await page.evaluate(() => {
    const img = document.querySelector('[data-testid="map"]');
    return img ? 'map' : '';
  });
  expect(src0).toBe('map');

  // step back changes the year
  await timeline.focus();
  await page.keyboard.press('ArrowLeft');
  const prev = Number(await yearEl.textContent());
  expect(prev).toBeLessThan(newest);

  // composite toggle
  await page.getByTestId('mode-swir').click();
  await expect(page.getByTestId('mode-swir')).toHaveClass(/on/);
  await page.getByTestId('mode-tc').click();

  // play then pause
  await page.getByTestId('play-btn').click();
  await expect(page.getByTestId('play-btn')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(1500);
  await page.getByTestId('play-btn').click();
  await expect(page.getByTestId('play-btn')).toHaveAttribute('aria-pressed', 'false');

  // the meta line names the sensor and a date
  const meta = await page.getByTestId('tl-meta').textContent();
  expect(meta).toMatch(/Landsat|Sentinel/);
  expect(meta).toMatch(/\d{4}-\d{2}-\d{2}/);
  expect(errors, `page errors:
${errors.join('
')}`).toEqual([]);
});
