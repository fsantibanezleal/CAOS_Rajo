// Gate for issue #37: the observatory must work when a third-party tile host hangs.
// Every request to the imagery host (tiles.maps.eox.at) is held open and never answered, which is what
// the office network does. The gate proves that the page still gets the map (on the first style.load, not
// on MapLibre's 'load', which waits for tiles), that the status line names the silent host, that choosing
// a site draws the polygons, the frame and the site's own relief source, that switching sites replaces
// the relief source, and that "World view" returns the camera to the globe. It failed against 0.02.007
// (the map never reached the page, so no overlay was ever added).
import { expect, test, type Route } from '@playwright/test';

import { collectErrors, expectNoErrors, gotoRajo } from './_helpers';

type RajoWindow = {
  __rajoMap?: {
    getZoom(): number;
    getPitch(): number;
    getCenter(): { lng: number; lat: number };
    getLayer(id: string): unknown;
    getStyle(): { sources: Record<string, { tiles?: string[] }> };
  };
};

test('the map works while the imagery host never answers', async ({ page, request }) => {
  test.setTimeout(240_000);
  const held: Route[] = [];
  await page.route(/tiles\.maps\.eox\.at/, (route) => {
    held.push(route);
  });
  const errors = collectErrors(page);
  try {
    await gotoRajo(page, '/');

    await expect
      .poll(() => page.evaluate(() => !!(window as unknown as RajoWindow).__rajoMap), { message: 'the map reaches the page without waiting for tiles', timeout: 30_000 })
      .toBe(true);

    await expect(page.getByTestId('map-stalled'), 'the status line names the silent host').toContainText('tiles.maps.eox.at', { timeout: 30_000 });

    const terrainTile = () =>
      page.evaluate(() => (window as unknown as RajoWindow).__rajoMap?.getStyle().sources['terrain-cop']?.tiles?.[0] ?? '');
    const hasLayer = (id: string) => page.evaluate((i) => !!(window as unknown as RajoWindow).__rajoMap?.getLayer(i), id);

    await page.getByTestId('site-select').selectOption('chuquicamata');
    await expect
      .poll(() => page.evaluate(() => { const m = (window as unknown as RajoWindow).__rajoMap; return !!m && m.getZoom() > 9 && m.getPitch() > 40; }), { message: 'the camera flew to the site', timeout: 20_000 })
      .toBe(true);
    await expect.poll(() => hasLayer('site-polygons-fill'), { message: 'site polygons drawn', timeout: 30_000 }).toBe(true);
    await expect.poll(() => hasLayer('frame-layer'), { message: 'frame layer drawn', timeout: 30_000 }).toBe(true);
    await expect.poll(terrainTile, { message: 'relief source of chuquicamata', timeout: 30_000 }).toContain('/sites/chuquicamata/');

    await page.getByTestId('site-select').selectOption('candelaria');
    await expect.poll(terrainTile, { message: 'relief source replaced by candelaria', timeout: 30_000 }).toContain('/sites/candelaria/');
    expect(await terrainTile()).not.toContain('/sites/chuquicamata/');
    const manifest = (await (await request.get('/data/sites/candelaria/manifest.json')).json()) as { window: { bbox_wgs84: [number, number, number, number] } };
    const [w, so, e, n] = manifest.window.bbox_wgs84;
    const cx = (w + e) / 2;
    const cy = (so + n) / 2;
    await expect
      .poll(
        () => page.evaluate(([x, y]) => { const c = (window as unknown as RajoWindow).__rajoMap!.getCenter(); return Math.abs(c.lng - x!) < 0.5 && Math.abs(c.lat - y!) < 0.5; }, [cx, cy]),
        { message: 'the camera centre is on candelaria', timeout: 30_000 },
      )
      .toBe(true);

    await page.getByTestId('site-select').selectOption('');
    await expect
      .poll(() => page.evaluate(() => { const m = (window as unknown as RajoWindow).__rajoMap!; return m.getZoom() < 3 && m.getPitch() < 1; }), { message: 'World view returns the camera to the globe', timeout: 15_000 })
      .toBe(true);
    await expect.poll(() => hasLayer('frame-layer'), { message: 'frame layer removed', timeout: 15_000 }).toBe(false);

    expectNoErrors(errors);
  } finally {
    for (const r of held) {
      try {
        await r.abort();
      } catch {
        /* the page may already be closed */
      }
    }
  }
});
