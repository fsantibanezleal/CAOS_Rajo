// Shared gate helpers. A gate must verify its own subject: every navigation asserts the page title
// before anything is measured, and captured errors are printed in the failing assertion.
import { expect, type Page } from '@playwright/test';

// A basemap tile that a third-party host failed to serve (MapLibre logs an AJAXError with status 0) is
// the network's state, not the app's: it is reported, never counted. Everything else counts.
const THIRD_PARTY_TILE = /AJAXError: .*\((0|429|5\d\d)\): https:\/\/(tiles\.maps\.eox\.at|tiles\.openfreemap\.org|[a-z]\.basemaps\.cartocdn\.com|s3\.amazonaws\.com\/elevation-tiles-prod)\//;

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  const tileFailures: string[] = [];
  // the stack names the frame that threw (a MapLibre render after a style swap looks like a route bug otherwise)
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${(e.stack ?? '').split('\n').slice(0, 6).join('\n')}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (THIRD_PARTY_TILE.test(text)) {
      tileFailures.push(text);
      if (tileFailures.length === 1) console.warn(`[gate] third-party tile failures are reported, not counted: ${text}`);
      return;
    }
    errors.push(`console: ${text}`);
  });
  return errors;
}

export async function gotoRajo(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page, 'the served page must be Rajo, not another product on the port').toHaveTitle(/Rajo/);
}

export function expectNoErrors(errors: string[]): void {
  expect(errors, `no console or page errors, got:\n${errors.join('\n')}`).toEqual([]);
}
