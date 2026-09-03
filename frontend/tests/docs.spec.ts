// The documentation surfaces by USE: the Methods page renders every method card with typeset equations
// and DOI links, the Data page renders the source tables and the catalog summary, the About page renders
// its sections, and the architecture modal opens from the header, shows five tabs each inlining a themed
// SVG whose text follows the language toggle, and closes on Escape.
import { expect, test } from '@playwright/test';

import { collectErrors, expectNoErrors, gotoRajo } from './_helpers';

test('the Methods page states twelve methods with equations and sources', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoRajo(page, '/methods');
  await expect(page.getByTestId('methods-page')).toBeVisible();
  for (let i = 1; i <= 12; i++) await expect(page.getByTestId(`method-M${i}`)).toBeVisible();
  const katex = await page.locator('.method-card .katex').count();
  expect(katex, 'every method card typesets at least one equation').toBeGreaterThanOrEqual(12);
  const dois = await page.locator('.method-card a[href^="https://doi.org/"]').count();
  expect(dois).toBeGreaterThanOrEqual(20);
  await expect(page.locator('.tex-error')).toHaveCount(0);
  await expect(page.locator('#benchmark')).toBeVisible();
  expectNoErrors(errors);
});

test('the Data page lists the sources, the facts, the contracts and the catalog as baked', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoRajo(page, '/data');
  await expect(page.getByTestId('data-page')).toBeVisible();
  for (const g of ['imagery', 'elevation', 'footprints', 'basemaps']) await expect(page.getByTestId(`sources-${g}`)).toBeVisible();
  expect(await page.locator('[data-testid^="sources-"] tbody tr').count()).toBeGreaterThanOrEqual(10);
  await expect(page.getByTestId('catalog-summary')).toBeVisible({ timeout: 60_000 });
  expect(await page.locator('[data-testid="catalog-summary"] tbody tr').count()).toBeGreaterThanOrEqual(30);
  await expect(page.getByTestId('attribution-table')).toContainText('EOX IT Services GmbH');
  expectNoErrors(errors);
});

test('the About page and the architecture modal (five bilingual diagrams) work in both languages', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoRajo(page, '/about');
  await expect(page.getByTestId('about-page')).toBeVisible();
  await expect(page.getByTestId('cite')).toContainText('Rajo');
  expect(await page.locator('[data-testid="about-page"] h2').count()).toBeGreaterThanOrEqual(5);

  await page.getByTestId('arch-btn').click();
  const modal = page.getByTestId('arch-modal');
  await expect(modal).toBeVisible();
  const tabs = ['app', 'lanes', 'webapp', 'science', 'contracts'];
  for (const id of tabs) {
    await page.getByTestId(`arch-tab-${id}`).click();
    const svg = modal.locator('[data-testid="arch-diagram"] svg');
    await expect(svg, `tab ${id} inlines its diagram`).toBeVisible({ timeout: 15_000 });
    const en = await svg.locator('text.l-en').count();
    const es = await svg.locator('text.l-es').count();
    expect(en, `tab ${id} has English text nodes`).toBeGreaterThan(20);
    expect(es, `tab ${id} has as many Spanish text nodes`).toBe(en);
    // exactly one language is displayed
    const visibleEs = await svg.locator('text.l-es').evaluateAll((els) => els.filter((e) => getComputedStyle(e).display !== 'none').length);
    expect(visibleEs).toBe(0);
    const hex = await svg.evaluate((el) => (el.outerHTML.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).filter((h) => !/^#(8594|8804|215)$/.test(h)).length);
    expect(hex, `tab ${id} has no hardcoded hex colour`).toBe(0);
  }
  // the modal covers the header, so the language is switched with it closed and the diagram reopened in Spanish
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await page.getByTestId('lang-btn').click();
  await page.getByTestId('arch-btn').click();
  await expect(page.getByTestId('arch-modal')).toHaveAttribute('data-arch-lang', 'es');
  const svgEs = page.locator('[data-testid="arch-diagram"] svg');
  await expect(svgEs).toBeVisible({ timeout: 15_000 });
  const visibleEn = await svgEs.locator('text.l-en').evaluateAll((els) => els.filter((e) => getComputedStyle(e).display !== 'none').length);
  const visibleEs2 = await svgEs.locator('text.l-es').evaluateAll((els) => els.filter((e) => getComputedStyle(e).display !== 'none').length);
  expect(visibleEn).toBe(0);
  expect(visibleEs2).toBeGreaterThan(20);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('arch-modal')).toHaveCount(0);
  await page.getByTestId('lang-btn').click();
  expectNoErrors(errors);
});
