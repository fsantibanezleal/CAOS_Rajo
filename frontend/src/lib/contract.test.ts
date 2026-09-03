import { describe, expect, it } from 'vitest';

import { CATALOG_SCHEMA, isCatalog, isSiteManifest, SITE_SCHEMA } from './contract';

describe('contract 2 guards', () => {
  it('accepts a well-formed catalog and rejects a count drift', () => {
    const ok = { schema: CATALOG_SCHEMA, engine_version: '0.01.000', n_sites: 1, sites: [{ site_id: 'x' }] };
    expect(isCatalog(ok)).toBe(true);
    expect(isCatalog({ ...ok, n_sites: 2 })).toBe(false);
    expect(isCatalog({ ...ok, schema: 'other' })).toBe(false);
  });

  it('accepts a site manifest shape', () => {
    expect(isSiteManifest({ schema: SITE_SCHEMA, site_id: 'x', frames: [], files: [] })).toBe(true);
    expect(isSiteManifest({ schema: SITE_SCHEMA, site_id: 'x', frames: 'no' })).toBe(false);
  });
});
