// A per-host circuit breaker in front of the third-party raster tile hosts (EOX imagery, AWS terrain).
// MapLibre loads every image through one FIFO queue capped at 16 requests (8 while the map moves), so a
// host that never answers holds all 16 slots: measured 2026-10-10 with the imagery held, the terrain
// requests were never issued and the status line blamed the healthy terrain host. The guard fails a silent
// host fast, frees the slots, probes it with backoff and reports it, so the other layers keep rendering.
import { addProtocol } from 'maplibre-gl';

export const GUARD_SCHEME = 'guarded';
export const REQUEST_TIMEOUT_MS = 8000;
export const FAILURES_TO_OPEN = 2;
export const OPEN_MS = 15_000;
export const OPEN_MAX_MS = 300_000;

export function guardUrl(httpsUrl: string): string {
  return httpsUrl.startsWith('https://') ? `${GUARD_SCHEME}://${httpsUrl.slice('https://'.length)}` : httpsUrl;
}

export function unguardUrl(guardedUrl: string): string {
  const prefix = `${GUARD_SCHEME}://`;
  return guardedUrl.startsWith(prefix) ? `https://${guardedUrl.slice(prefix.length)}` : guardedUrl;
}

export interface TileGuardEnv {
  fetch: typeof fetch;
  now: () => number;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

export interface GuardEvent {
  host: string;
  state: 'open' | 'closed';
}

export interface TileResponse {
  data: ArrayBuffer;
  cacheControl?: string;
  expires?: string;
}

interface HostState {
  failures: number;
  open: boolean;
  openMs: number;
  lastUrl: string;
  timer: ReturnType<typeof setTimeout> | null;
}

const defaultEnv = (): TileGuardEnv => ({
  fetch: (...a) => globalThis.fetch(...a),
  now: () => Date.now(),
  setTimeout: ((fn: () => void, ms?: number) => globalThis.setTimeout(fn, ms)) as typeof setTimeout,
  clearTimeout: ((id: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id)) as typeof clearTimeout,
});

export class TileGuard {
  private readonly env: TileGuardEnv;
  private readonly hosts = new Map<string, HostState>();
  private readonly listeners = new Set<(e: GuardEvent) => void>();

  constructor(env: TileGuardEnv = defaultEnv()) {
    this.env = env;
  }

  subscribe(fn: (e: GuardEvent) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  openHosts(): string[] {
    return [...this.hosts.entries()].filter(([, s]) => s.open).map(([h]) => h).sort();
  }

  async load(httpsUrl: string, signal?: AbortSignal, headers?: Record<string, string>): Promise<TileResponse> {
    const host = new URL(httpsUrl).host;
    const st = this.state(host);
    if (st.open) throw new Error(`${host} is not answering`);
    let res: Response;
    let body: ArrayBuffer;
    try {
      res = await this.request(httpsUrl, signal, headers);
      if (res.status === 429 || res.status >= 500) {
        this.fail(host, httpsUrl);
        throw new Error(`${host} answered ${res.status}`);
      }
      if (!res.ok) {
        this.succeed(host);
        throw new Error(`${host} answered ${res.status}`);
      }
      body = await res.arrayBuffer();
    } catch (e) {
      // an abort by MapLibre (the tile is no longer needed) says nothing about the host; a failure was
      // already counted above for 429 and 5xx, and an answered 4xx is a reachable host
      if (!signal?.aborted && !(e instanceof Error && /answered \d+$/.test(e.message))) this.fail(host, httpsUrl);
      throw e;
    }
    this.succeed(host);
    return {
      data: body,
      cacheControl: res.headers.get('Cache-Control') ?? undefined,
      expires: res.headers.get('Expires') ?? undefined,
    };
  }

  private state(host: string): HostState {
    let s = this.hosts.get(host);
    if (!s) {
      s = { failures: 0, open: false, openMs: OPEN_MS, lastUrl: '', timer: null };
      this.hosts.set(host, s);
    }
    return s;
  }

  // one fetch bounded by REQUEST_TIMEOUT_MS and by the caller's signal
  private async request(url: string, signal?: AbortSignal, headers?: Record<string, string>): Promise<Response> {
    const timeout = new AbortController();
    const timer = this.env.setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
    let combined: AbortSignal = timeout.signal;
    let detach = () => {};
    if (signal) {
      if (typeof AbortSignal.any === 'function') {
        combined = AbortSignal.any([signal, timeout.signal]);
      } else {
        const manual = new AbortController();
        const onAbort = () => manual.abort();
        signal.addEventListener('abort', onAbort);
        timeout.signal.addEventListener('abort', onAbort);
        if (signal.aborted || timeout.signal.aborted) manual.abort();
        combined = manual.signal;
        detach = () => signal.removeEventListener('abort', onAbort);
      }
    }
    try {
      return await this.env.fetch(url, { signal: combined, headers, mode: 'cors' });
    } finally {
      this.env.clearTimeout(timer);
      detach();
    }
  }

  private fail(host: string, url: string): void {
    const st = this.state(host);
    st.lastUrl = url;
    if (st.open) return;
    st.failures += 1;
    if (st.failures >= FAILURES_TO_OPEN) {
      st.open = true;
      this.emit({ host, state: 'open' });
      this.scheduleProbe(host);
    }
  }

  private succeed(host: string): void {
    const st = this.state(host);
    if (!st.open) st.failures = 0;
  }

  private scheduleProbe(host: string): void {
    const st = this.state(host);
    if (st.timer !== null) return;
    st.timer = this.env.setTimeout(() => {
      st.timer = null;
      void this.probe(host);
    }, st.openMs);
  }

  private async probe(host: string): Promise<void> {
    const st = this.state(host);
    if (!st.open) return;
    try {
      const res = await this.request(st.lastUrl);
      void res.body?.cancel?.().catch(() => undefined);
    } catch {
      st.openMs = Math.min(st.openMs * 2, OPEN_MAX_MS);
      this.scheduleProbe(host);
      return;
    }
    if (st.timer !== null) this.env.clearTimeout(st.timer);
    st.timer = null;
    st.open = false;
    st.failures = 0;
    st.openMs = OPEN_MS;
    this.emit({ host, state: 'closed' });
  }

  private emit(e: GuardEvent): void {
    for (const fn of [...this.listeners]) fn(e);
  }
}

export const tileGuard = new TileGuard();

let registered = false;

/** Registers the `guarded://` scheme with MapLibre; every tile of a guarded source goes through tileGuard. */
export function registerTileGuard(): void {
  if (registered) return;
  registered = true;
  addProtocol(GUARD_SCHEME, (params, abortController) =>
    tileGuard.load(unguardUrl(params.url), abortController.signal, params.headers as Record<string, string> | undefined),
  );
}
