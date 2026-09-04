// The time-lapse by USE: for a site with frames, the timeline appears with the newest year, stepping
// changes the year, the composite toggle swaps the image, play starts paused and can be started and
// stopped, and the meta line names the sensor and an acquisition date.
import { expect, test } from '@playwright/test';

import { collectErrors, expectNoErrors, gotoRajo } from './_helpers';

test('timeline steps years, swaps composites, plays only on demand, and names the sensor', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoRajo(page, '/?site=chuquicamata');
  await page.waitForSelector('[data-testid="map"] canvas', { timeout: 60_000 });
  const timeline = page.getByTestId('timeline');
  await expect(timeline).toBeVisible({ timeout: 30_000 });
  const yearEl = page.getByTestId('tl-year');
  await expect(yearEl).not.toHaveText('', { timeout: 30_000 });
  const newest = Number(await yearEl.textContent());
  expect(newest).toBeGreaterThanOrEqual(2017);

  // paused by default
  await expect(page.getByTestId('play-btn')).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(3000);

  // step back changes the year
  await timeline.focus();
  await page.keyboard.press('ArrowLeft');
  const prev = Number(await yearEl.textContent());
  expect(prev).toBeLessThan(newest);

  // the site card prints sourced facts: every fact carries a link to its source (Contract 1)
  const facts = page.locator('ul.facts li');
  await expect(facts.first()).toBeVisible();
  const nFacts = await facts.count();
  expect(nFacts).toBeGreaterThanOrEqual(1);
  for (let i = 0; i < nFacts; i++) {
    const href = await facts.nth(i).locator('a').getAttribute('href');
    expect(href, `fact ${i} links to its source`).toMatch(/^https?:\/\//);
  }
  await expect(page.locator('ul.facts')).toContainText(/Cochilco/); // Chuquicamata carries the primary production table

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

  const meta = await page.getByTestId('tl-meta').textContent();
  expect(meta).toMatch(/Landsat|Sentinel/);
  expect(meta).toMatch(/\d{4}-\d{2}-\d{2}/);
  expectNoErrors(errors);
});
