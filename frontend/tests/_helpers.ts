// Shared gate helpers. A gate must verify its own subject: every navigation asserts the page title
// before anything is measured, and captured errors are printed in the failing assertion.
import { expect, type Page } from '@playwright/test';

// A basemap tile that a third-party host failed to serve (MapLibre logs an AJAXError with status 0) is
// the network's state, not the app's: it is reported, never counted. Everything else counts.
const TILE_HOSTS = /^https:\/\/(tiles\.maps\.eox\.at|tiles\.openfreemap\.org|[a-z]\.basemaps\.cartocdn\.com|s3\.amazonaws\.com\/elevation-tiles-prod)\//;
const THIRD_PARTY_TILE = new RegExp(`AJAXError: .*\\((0|429|5\\d\\d)\\): ${TILE_HOSTS.source.slice(1)}`);
// Chromium also logs "Failed to load resource: net::ERR_..." for each failed request; its text carries no
// URL, the message location does (a host that never connects, 2026-10-10, issue #37).
const NETWORK_FAILURE = /^Failed to load resource: (net::ERR_|the server responded with a status of (429|5\d\d))/;

function isThirdPartyTileFailure(text: string, url: string): boolean {
  return THIRD_PARTY_TILE.test(text) || (NETWORK_FAILURE.test(text) && TILE_HOSTS.test(url));
}

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  const tileFailures: string[] = [];
  // the stack names the frame that threw (a MapLibre render after a style swap looks like a route bug otherwise)
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${(e.stack ?? '').split('\n').slice(0, 6).join('\n')}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    const url = m.location()?.url ?? '';
    if (isThirdPartyTileFailure(text, url)) {
      tileFailures.push(`${text} ${url}`);
      if (tileFailures.length === 1) console.warn(`[gate] third-party tile failures are reported, not counted: ${text} ${url}`);
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
