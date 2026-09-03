// Change points on the mined-area series (M10) and harmonic regression with breaks (M11), mirrored
// line for line from data-pipeline/rajo/changepoints.py. The golden fixture test replays the same
// inputs through both implementations; the site gate replays every baked series and expects the
// recorded breaks. The app reruns these live when the user moves the penalty or the segment length.

export interface Segment {
  start: number;
  end: number; // inclusive index
  mean: number;
  slope: number;
}

export interface PeltResult {
  breaks: number[];
  segments: Segment[];
  penalty: number;
  sigma: number;
  cost: 'l2';
  minSize: number;
}

export interface CusumResult {
  alarms: number[];
  k: number;
  h: number;
  sigma: number;
  target: number;
  stat: number[];
}

function median(a: number[]): number {
  if (a.length === 0) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function diff(x: number[]): number[] {
  const d: number[] = [];
  for (let i = 1; i < x.length; i++) d.push(x[i]! - x[i - 1]!);
  return d;
}

function std(a: number[]): number {
  if (a.length === 0) return 0;
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length);
}

/** 1.4826 * MAD of the first differences. */
export function robustSigma(x: number[]): number {
  const d = diff(x);
  if (d.length === 0) return 0;
  const med = median(d);
  return 1.4826 * median(d.map((v) => Math.abs(v - med)));
}

export function cusum(values: number[], kSigma = 0.5, hSigma = 4): CusumResult {
  const d = diff(values);
  if (d.length < 3) return { alarms: [], k: 0, h: 0, sigma: 0, target: 0, stat: [] };
  let sigma = robustSigma(values);
  if (sigma <= 0) sigma = std(d) || 1e-9;
  const mu0 = median(d);
  const k = kSigma * sigma;
  const h = hSigma * sigma;
  let s = 0;
  const stat: number[] = [];
  const alarms: number[] = [];
  for (let i = 0; i < d.length; i++) {
    s = Math.max(0, s + (d[i]! - mu0 - k));
    stat.push(s);
    if (s > h) {
      alarms.push(i + 1);
      s = 0;
    }
  }
  return { alarms, k, h, sigma, target: mu0, stat };
}

function segCost(c1: Float64Array, c2: Float64Array, a: number, b: number): number {
  const n = b - a;
  const s1 = c1[b]! - c1[a]!;
  const s2 = c2[b]! - c2[a]!;
  return s2 - (s1 * s1) / n;
}

function segment(x: number[], a: number, b: number): Segment {
  const n = b - a;
  let sum = 0;
  for (let i = a; i < b; i++) sum += x[i]!;
  const mean = sum / n;
  let slope = 0;
  if (n >= 2) {
    // least-squares slope against the index, as numpy.polyfit(t, seg, 1)[0]
    let tm = 0;
    for (let i = a; i < b; i++) tm += i;
    tm /= n;
    let num = 0;
    let den = 0;
    for (let i = a; i < b; i++) {
      num += (i - tm) * (x[i]! - mean);
      den += (i - tm) * (i - tm);
    }
    slope = den > 0 ? num / den : 0;
  }
  return { start: a, end: b - 1, mean, slope };
}

/** Optimal partition under the L2 cost with a linear penalty (PELT with pruning). */
export function pelt(values: number[], penalty?: number, minSize = 3, sigmaIn?: number): PeltResult {
  const x = values;
  const n = x.length;
  let sigma = sigmaIn ?? robustSigma(x);
  if (sigmaIn === undefined && sigma <= 0) sigma = n > 1 ? std(diff(x)) : 0;
  const pen = penalty ?? 3 * sigma * sigma * Math.log(Math.max(n, 2));
  if (n < 2 * minSize) return { breaks: [], segments: [segment(x, 0, n)], penalty: pen, sigma, cost: 'l2', minSize };
  const c1 = new Float64Array(n + 1);
  const c2 = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    c1[i + 1] = c1[i]! + x[i]!;
    c2[i + 1] = c2[i]! + x[i]! * x[i]!;
  }
  const f = new Float64Array(n + 1).fill(Infinity);
  f[0] = -pen;
  const last = new Int32Array(n + 1);
  let cands: number[] = [0];
  for (let t = minSize; t <= n; t++) {
    let best = Infinity;
    let arg = 0;
    for (const s of cands) {
      if (t - s < minSize) continue;
      const v = f[s]! + segCost(c1, c2, s, t) + pen;
      if (v < best) {
        best = v;
        arg = s;
      }
    }
    f[t] = best;
    last[t] = arg;
    cands = cands.filter((s) => t - s < minSize || f[s]! + segCost(c1, c2, s, t) <= best);
    cands.push(t);
  }
  const breaks: number[] = [];
  let t = n;
  while (t > 0) {
    const s = last[t]!;
    if (s > 0) breaks.push(s);
    t = s;
  }
  breaks.sort((a, b) => a - b);
  const bounds = [0, ...breaks, n];
  const segments: Segment[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) segments.push(segment(x, bounds[i]!, bounds[i + 1]!));
  return { breaks, segments, penalty: pen, sigma, cost: 'l2', minSize };
}

// --- M11 harmonic regression with breaks -----------------------------------------------------------

export interface HarmonicSegment {
  start: number;
  end: number;
  coef: number[];
  rss: number;
  n: number;
}

export interface HarmonicResult {
  breaks: number[];
  k: number;
  periodDays: number;
  bic: number;
  bicNoBreak: number;
  rss: number;
  minSegmentDays: number;
  segments: HarmonicSegment[];
}

export function harmonicDesign(tDays: number[], k = 2, period = 365.25): number[][] {
  return tDays.map((t) => {
    const row = [1, t / period];
    for (let j = 1; j <= k; j++) {
      const w = (2 * Math.PI * j * t) / period;
      row.push(Math.cos(w), Math.sin(w));
    }
    return row;
  });
}

/** Least squares by the normal equations with Gaussian elimination (p is 6 at most). */
function lstsq(X: number[][], y: number[]): { coef: number[]; rss: number } {
  const p = X[0]!.length;
  const A: number[][] = Array.from({ length: p }, () => new Array<number>(p + 1).fill(0));
  for (let r = 0; r < X.length; r++) {
    const row = X[r]!;
    for (let i = 0; i < p; i++) {
      for (let j = 0; j < p; j++) A[i]![j] = A[i]![j]! + row[i]! * row[j]!;
      A[i]![p] = A[i]![p]! + row[i]! * y[r]!;
    }
  }
  for (let i = 0; i < p; i++) A[i]![i] = A[i]![i]! + 1e-12; // ridge against exact collinearity
  for (let col = 0; col < p; col++) {
    let piv = col;
    for (let r = col + 1; r < p; r++) if (Math.abs(A[r]![col]!) > Math.abs(A[piv]![col]!)) piv = r;
    [A[col], A[piv]] = [A[piv]!, A[col]!];
    const d = A[col]![col]! || 1e-18;
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const m = A[r]![col]! / d;
      if (m === 0) continue;
      for (let c = col; c <= p; c++) A[r]![c] = A[r]![c]! - m * A[col]![c]!;
    }
  }
  const coef = A.map((row, i) => row[p]! / (row[i]! || 1e-18));
  let rss = 0;
  for (let r = 0; r < X.length; r++) {
    let yh = 0;
    for (let i = 0; i < p; i++) yh += X[r]![i]! * coef[i]!;
    rss += (y[r]! - yh) * (y[r]! - yh);
  }
  return { coef, rss };
}

function fit(t: number[], y: number[], k: number, period: number): { coef: number[]; rss: number } {
  return lstsq(harmonicDesign(t, k, period), y);
}

export function harmonicBreaks(tDays: number[], y: number[], k = 2, period = 365.25, minSegmentDays = 365, maxBreaks = 2, step = 1): HarmonicResult {
  const n = tDays.length;
  const p = 2 + 2 * k;
  const bic = (rss: number, nParams: number) => n * Math.log(Math.max(rss / n, 1e-12)) + nParams * Math.log(n);
  const base = fit(tDays, y, k, period);
  let best: { breaks: number[]; rss: number; bic: number; segments: Array<[number, number, number[], number]> } = {
    breaks: [],
    rss: base.rss,
    bic: bic(base.rss, p),
    segments: [[0, n, base.coef, base.rss]],
  };
  const bicNoBreak = best.bic;
  const valid = (i: number, j: number) => tDays[j - 1]! - tDays[i]! >= minSegmentDays && j - i > p;
  const cands: number[] = [];
  for (let i = 0; i < n; i += step) cands.push(i);
  if (maxBreaks >= 1) {
    for (const b1 of cands) {
      if (!(valid(0, b1) && valid(b1, n))) continue;
      const a = fit(tDays.slice(0, b1), y.slice(0, b1), k, period);
      const b = fit(tDays.slice(b1), y.slice(b1), k, period);
      const rss = a.rss + b.rss;
      const score = bic(rss, 2 * p + 1);
      if (score < best.bic) best = { breaks: [b1], rss, bic: score, segments: [[0, b1, a.coef, a.rss], [b1, n, b.coef, b.rss]] };
    }
  }
  if (maxBreaks >= 2 && n >= 3 * (p + 1)) {
    for (const b1 of cands) {
      if (!valid(0, b1)) continue;
      const a = fit(tDays.slice(0, b1), y.slice(0, b1), k, period);
      for (const b2 of cands) {
        if (b2 <= b1 || !(valid(b1, b2) && valid(b2, n))) continue;
        const b = fit(tDays.slice(b1, b2), y.slice(b1, b2), k, period);
        const c = fit(tDays.slice(b2), y.slice(b2), k, period);
        const rss = a.rss + b.rss + c.rss;
        const score = bic(rss, 3 * p + 2);
        if (score < best.bic) best = { breaks: [b1, b2], rss, bic: score, segments: [[0, b1, a.coef, a.rss], [b1, b2, b.coef, b.rss], [b2, n, c.coef, c.rss]] };
      }
    }
  }
  return {
    breaks: best.breaks,
    k,
    periodDays: period,
    bic: best.bic,
    bicNoBreak,
    rss: best.rss,
    minSegmentDays,
    segments: best.segments.map(([a, b, coef, rss]) => ({ start: a, end: b - 1, coef, rss, n: b - a })),
  };
}
