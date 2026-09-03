// Loads the baked catalog (public/data/catalog.json) once and validates it against Contract 2.
import { useEffect, useState } from 'react';

import { type Catalog, isCatalog } from '../lib/contract';

let cache: Promise<Catalog> | null = null;

export function loadCatalog(): Promise<Catalog> {
  if (!cache) {
    cache = fetch(`${import.meta.env.BASE_URL}data/catalog.json`, { cache: 'no-cache' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`catalog ${r.status}`);
        const j: unknown = await r.json();
        if (!isCatalog(j)) throw new Error('catalog does not satisfy rajo.catalog/v1');
        return j;
      })
      .catch((e: unknown) => {
        cache = null;
        throw e;
      });
  }
  return cache;
}

export function useCatalog(): { catalog: Catalog | null; error: string | null } {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadCatalog()
      .then((c) => alive && setCatalog(c))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);
  return { catalog, error };
}
