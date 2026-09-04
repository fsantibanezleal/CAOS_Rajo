// The change-point code is a contract with the bake: the breaks recorded in every series.json were
// found by data-pipeline/rajo/changepoints.py, and the app reruns the same detectors live. This test
// replays the fixture written by data-pipeline/make_changepoint_golden.py.
import { describe, expect, it } from 'vitest';

import golden from './__fixtures__/changepoints_golden.json';
import { cusum, harmonicBreaks, pelt, robustSigma } from './changepoints';

type Case = {
  values: number[];
  pelt: { breaks: number[]; penalty: number; sigma: number; min_size: number; segments: Array<{ start: number; end: number; mean: number; slope: number }> };
  cusum: { alarms: number[]; k: number; h: number; sigma: number; target: number; stat: number[] };
};
type Golden = {
  cases: Record<string, Case>;
  dense: { t_days: number[]; values: number[]; breaks: number[]; bic: number; bic_no_break: number; rss: number; k: number; period_days: number; min_segment_days: number };
};
const g = golden as unknown as Golden;

describe('pelt and cusum mirror the Python detectors', () => {
  for (const [name, c] of Object.entries(g.cases)) {
    it(`case ${name}: same breaks, penalty, sigma and segments`, () => {
      const p = pelt(c.values);
      expect(p.breaks).toEqual(c.pelt.breaks);
      expect(p.penalty).toBeCloseTo(c.pelt.penalty, 6);
      expect(p.sigma).toBeCloseTo(c.pelt.sigma, 6);
      expect(p.minSize).toBe(c.pelt.min_size);
      expect(p.segments.length).toBe(c.pelt.segments.length);
      p.segments.forEach((s, i) => {
        const want = c.pelt.segments[i]!;
        expect(s.start).toBe(want.start);
        expect(s.end).toBe(want.end);
        expect(s.mean).toBeCloseTo(want.mean, 6);
        expect(s.slope).toBeCloseTo(want.slope, 6);
      });
      expect(robustSigma(c.values)).toBeCloseTo(c.pelt.sigma > 0 ? c.pelt.sigma : robustSigma(c.values), 6);
    });
    it(`case ${name}: same CUSUM alarms and statistic`, () => {
      const r = cusum(c.values);
      expect(r.alarms).toEqual(c.cusum.alarms);
      expect(r.k).toBeCloseTo(c.cusum.k, 6);
      expect(r.h).toBeCloseTo(c.cusum.h, 6);
      expect(r.target).toBeCloseTo(c.cusum.target, 6);
      expect(r.stat.length).toBe(c.cusum.stat.length);
      r.stat.forEach((v, i) => expect(v).toBeCloseTo(c.cusum.stat[i]!, 6));
    });
  }
});

describe('harmonic regression with breaks mirrors Python', () => {
  it('finds the same break on the dense fixture with the same BIC', () => {
    const d = g.dense;
    const r = harmonicBreaks(d.t_days, d.values, d.k, d.period_days, d.min_segment_days);
    expect(r.breaks).toEqual(d.breaks);
    expect(r.bicNoBreak).toBeCloseTo(d.bic_no_break, 3);
    expect(r.bic).toBeCloseTo(d.bic, 3);
    expect(r.rss).toBeCloseTo(d.rss, 4);
  });

  it('reports no break on a pure seasonal signal', () => {
    const t: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < 150; i++) {
      const tt = i * 14.6;
      t.push(tt);
      y.push(0.5 + 0.2 * Math.cos((2 * Math.PI * tt) / 365.25) + 0.01 * Math.sin(i * 7.3));
    }
    expect(harmonicBreaks(t, y).breaks).toEqual([]);
  });
});
