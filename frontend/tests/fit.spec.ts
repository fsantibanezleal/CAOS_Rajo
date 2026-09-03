// The UI floor, measured: the page is the viewport (no horizontal drag, no scroll to the footer), the
// navigation chrome is one row, the instrument (the map canvas) takes at least half of the viewport, in
// both themes, at three viewport sizes. A page that fails any of these is broken, not nearly done.
import { expect, test } from '@playwright/test';

const SIZES: Array<[number, number]> = [
  [1280, 800],
  [1600, 900],
  [2560, 1440],
];

for (const theme of ['dark', 'light'] as const) {
  for (const [w, h] of SIZES) {
    test(`fit ${theme} ${w}x${h}`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      await page.addInitScript((t) => localStorage.setItem('rajo.theme', t), theme);
      await page.goto('/');
      await page.waitForSelector('[data-testid="map"] canvas', { timeout: 60_000 });
      await page.waitForTimeout(2500);

      const r = await page.evaluate(() => {
        const de = document.documentElement;
        const canvas = document.querySelector('[data-testid="map"] canvas') as HTMLCanvasElement | null;
        const cr = canvas?.getBoundingClientRect();
        const nav = document.querySelector('.hdr nav');
        const links = nav ? [...nav.querySelectorAll('a')] : [];
        const rows = new Set(links.map((a) => Math.round(a.getBoundingClientRect().top)));
        return {
          theme: de.getAttribute('data-theme'),
          overX: de.scrollWidth > innerWidth + 1,
          overY: de.scrollHeight > innerHeight + 2,
          vizPct: cr ? (cr.width * cr.height) / (innerWidth * innerHeight) : 0,
          navRows: rows.size,
          navCount: links.length,
        };
      });
      expect(r.theme).toBe(theme);
      expect(r.overX, 'no horizontal overflow').toBe(false);
      expect(r.overY, 'no vertical overflow').toBe(false);
      expect(r.navRows, 'one navigation row').toBe(1);
      expect(r.navCount).toBe(5);
      expect(r.vizPct, 'the map takes at least half the viewport').toBeGreaterThan(0.5);
      expect(errors, 'no console or page errors').toEqual([]);
      await ctx.close();
    });
  }
}
