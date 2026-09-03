// The selected site: id in the URL (?site=), the manifest loaded and validated against Contract 2.
import { useEffect, useState } from 'react';

import { isSiteManifest, type SiteManifest } from '../lib/contract';

const manifestCache = new Map<string, Promise<SiteManifest>>();

export function loadManifest(siteId: string, manifestPath: string): Promise<SiteManifest> {
  let p = manifestCache.get(siteId);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/${manifestPath}`, { cache: 'no-cache' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`manifest ${siteId} ${r.status}`);
        const j: unknown = await r.json();
        if (!isSiteManifest(j)) throw new Error(`manifest ${siteId} does not satisfy rajo.site/v1`);
        return j;
      })
      .catch((e: unknown) => {
        manifestCache.delete(siteId);
        throw e;
      });
    manifestCache.set(siteId, p);
  }
  return p;
}

export function readSiteParam(): string {
  try {
    return new URLSearchParams(window.location.search).get('site') ?? '';
  } catch {
    return '';
  }
}

export function writeSiteParam(siteId: string): void {
  try {
    const url = new URL(window.location.href);
    if (siteId) url.searchParams.set('site', siteId);
    else url.searchParams.delete('site');
    window.history.replaceState(null, '', url.toString());
  } catch {
    /* ignore */
  }
}

export function useManifest(siteId: string, manifestPath: string | undefined): { manifest: SiteManifest | null; error: string | null } {
  const [manifest, setManifest] = useState<SiteManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setManifest(null);
    setError(null);
    if (!siteId || !manifestPath) return;
    loadManifest(siteId, manifestPath)
      .then((m) => alive && setManifest(m))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [siteId, manifestPath]);
  return { manifest, error };
}
