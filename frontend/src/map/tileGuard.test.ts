import { describe, expect, it } from 'vitest';

import { guardUrl, unguardUrl, TileGuard, FAILURES_TO_OPEN, OPEN_MS, OPEN_MAX_MS, REQUEST_TIMEOUT_MS } from './tileGuard';

const URL_A = 'https://tiles.example.org/wmts/1/2/3.jpg';

interface Timer {
  id: number;
  fn: () => void;
  ms: number;
  cleared: boolean;
  fired: boolean;
}

// A fake environment: fetch answers from a script (a status, 'hang' or 'reject'); timers fire by hand.
function makeEnv() {
  const timers: Timer[] = [];
  const calls: string[] = [];
  const script: Array<number | 'hang' | 'reject'> = [];
  let next = 0;
  const env = {
    fetch: ((url: string, init?: { signal?: AbortSignal }) => {
      calls.push(url);
      const step = script.shift() ?? 200;
      return new Promise<Response>((resolve, reject) => {
        const abort = () => reject(new DOMException('aborted', 'AbortError'));
        if (init?.signal?.aborted) return abort();
        init?.signal?.addEventListener('abort', abort);
        if (step === 'hang') return;
        if (step === 'reject') return reject(new TypeError('Failed to fetch'));
        resolve(new Response(new Uint8Array([1, 2, 3]), { status: step }));
      });
    }) as unknown as typeof fetch,
    now: () => 0,
    setTimeout: ((fn: () => void, ms: number) => {
      const t: Timer = { id: ++next, fn, ms, cleared: false, fired: false };
      timers.push(t);
      return t.id as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout,
    clearTimeout: ((id: number) => {
      const t = timers.find((x) => x.id === id);
      if (t) t.cleared = true;
    }) as unknown as typeof clearTimeout,
  };
  const pending = (ms?: number) => timers.filter((t) => !t.cleared && !t.fired && (ms === undefined || t.ms === ms));
  const probes = () => pending().filter((t) => t.ms !== REQUEST_TIMEOUT_MS);
  const fire = (t: Timer) => {
    t.fired = true;
    t.fn();
  };
  return { env, timers, calls, script, pending, probes, fire };
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

// make one load end in a timeout: the request hangs and its timeout timer fires
async function timeoutOnce(g: TileGuard, f: ReturnType<typeof makeEnv>, url = URL_A) {
  f.script.push('hang');
  const caught = g.load(url, new AbortController().signal).catch((e: unknown) => e);
  await flush();
  f.fire(f.pending(REQUEST_TIMEOUT_MS).at(-1)!);
  await caught;
}

async function openCircuit(g: TileGuard, f: ReturnType<typeof makeEnv>) {
  for (let i = 0; i < FAILURES_TO_OPEN; i++) await timeoutOnce(g, f);
}

describe('TileGuard', () => {
  it('opens the circuit after two timeouts and emits open', async () => {
    const f = makeEnv();
    const g = new TileGuard(f.env);
    const events: Array<{ host: string; state: string }> = [];
    g.subscribe((e) => events.push(e));
    await timeoutOnce(g, f);
    expect(g.openHosts()).toEqual([]);
    await timeoutOnce(g, f);
    expect(g.openHosts()).toEqual(['tiles.example.org']);
    expect(events).toEqual([{ host: 'tiles.example.org', state: 'open' }]);
    expect(f.pending(OPEN_MS)).toHaveLength(1);
  });

  it('rejects at once while open and never calls fetch', async () => {
    const f = makeEnv();
    const g = new TileGuard(f.env);
    await openCircuit(g, f);
    const before = f.calls.length;
    await expect(g.load(URL_A, new AbortController().signal)).rejects.toThrow('tiles.example.org is not answering');
    expect(f.calls.length).toBe(before);
  });

  it('does not count an abort by the caller as a failure', async () => {
    const f = makeEnv();
    const g = new TileGuard(f.env);
    for (let i = 0; i < 5; i++) {
      f.script.push('hang');
      const ctrl = new AbortController();
      const p = g.load(URL_A, ctrl.signal).catch((e: unknown) => e);
      await flush();
      ctrl.abort();
      await p;
    }
    expect(g.openHosts()).toEqual([]);
  });

  it('treats a 404 as an answer and a 503 as a failure', async () => {
    const f = makeEnv();
    const g = new TileGuard(f.env);
    for (let i = 0; i < 4; i++) {
      f.script.push(404);
      await g.load(URL_A, new AbortController().signal).catch(() => undefined);
    }
    expect(g.openHosts()).toEqual([]);
    for (let i = 0; i < FAILURES_TO_OPEN; i++) {
      f.script.push(503);
      await g.load(URL_A, new AbortController().signal).catch(() => undefined);
    }
    expect(g.openHosts()).toEqual(['tiles.example.org']);
  });

  it('counts a network error as a failure and a success resets the count', async () => {
    const f = makeEnv();
    const g = new TileGuard(f.env);
    f.script.push('reject');
    await g.load(URL_A, new AbortController().signal).catch(() => undefined);
    f.script.push(200);
    const ok = await g.load(URL_A, new AbortController().signal);
    expect(ok.data.byteLength).toBe(3);
    f.script.push('reject');
    await g.load(URL_A, new AbortController().signal).catch(() => undefined);
    expect(g.openHosts()).toEqual([]);
  });

  it('closes on a probe answer, emits closed and resets the delay', async () => {
    const f = makeEnv();
    const g = new TileGuard(f.env);
    const events: string[] = [];
    g.subscribe((e) => events.push(e.state));
    await openCircuit(g, f);
    // the first probe fails, so the delay doubles
    f.script.push('reject');
    f.fire(f.pending(OPEN_MS)[0]!);
    await flush();
    expect(g.openHosts()).toEqual(['tiles.example.org']);
    // the second probe gets an answer (any status)
    f.script.push(404);
    f.fire(f.pending(OPEN_MS * 2)[0]!);
    await flush();
    expect(g.openHosts()).toEqual([]);
    expect(events).toEqual(['open', 'closed']);
    expect(f.probes()).toHaveLength(0);
    // the delay is back to the first value on the next opening
    await openCircuit(g, f);
    expect(f.pending(OPEN_MS)).toHaveLength(1);
  });

  it('doubles the probe delay on every failed probe up to the cap', async () => {
    const f = makeEnv();
    const g = new TileGuard(f.env);
    await openCircuit(g, f);
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      const t = f.probes()[0]!;
      delays.push(t.ms);
      f.script.push('reject');
      f.fire(t);
      await flush();
    }
    expect(delays).toEqual([15000, 30000, 60000, 120000, 240000, OPEN_MAX_MS, OPEN_MAX_MS, OPEN_MAX_MS]);
    expect(OPEN_MAX_MS).toBe(300000);
  });

  it('probes the last failed URL', async () => {
    const f = makeEnv();
    const g = new TileGuard(f.env);
    await timeoutOnce(g, f, URL_A);
    await timeoutOnce(g, f, 'https://tiles.example.org/other.jpg');
    f.script.push(200);
    f.fire(f.pending(OPEN_MS)[0]!);
    await flush();
    expect(f.calls.at(-1)).toBe('https://tiles.example.org/other.jpg');
  });
});

describe('guardUrl', () => {
  it('round trips and leaves other schemes alone', () => {
    const g = guardUrl('https://tiles.maps.eox.at/wmts/{z}/{y}/{x}.jpg');
    expect(g).toBe('guarded://tiles.maps.eox.at/wmts/{z}/{y}/{x}.jpg');
    expect(new URL('guarded://tiles.maps.eox.at/x').host).toBe('tiles.maps.eox.at');
    expect(unguardUrl(g)).toBe('https://tiles.maps.eox.at/wmts/{z}/{y}/{x}.jpg');
    expect(guardUrl('http://a/b')).toBe('http://a/b');
    expect(unguardUrl('http://a/b')).toBe('http://a/b');
  });
});
