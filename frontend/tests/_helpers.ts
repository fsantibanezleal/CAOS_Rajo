// Shared gate helpers. A gate must verify its own subject: every navigation asserts the page title
// before anything is measured, and captured errors are printed in the failing assertion.
import { expect, type Page } from '@playwright/test';

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
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
