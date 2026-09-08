// A number is part of the language. The app printed "272.9 km2" and "0.378" to a Spanish reader,
// which is the same defect as printing an English word there, so the formatter is gated.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import i18n from '../i18n';
import { int, num } from './format';

describe('displayed numbers follow the reader language', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('writes a point in English and a comma in Spanish', async () => {
    await i18n.changeLanguage('en');
    expect(num(272.9, 1)).toBe('272.9');
    expect(num(0.378, 3)).toBe('0.378');
    await i18n.changeLanguage('es');
    expect(num(272.9, 1)).toBe('272,9');
    expect(num(0.378, 3)).toBe('0,378');
    await i18n.changeLanguage('en');
  });

  it('groups thousands the way each language groups them', async () => {
    await i18n.changeLanguage('en');
    expect(int(11506)).toBe('11,506');
    await i18n.changeLanguage('es');
    expect(int(11506)).toBe('11.506');
    await i18n.changeLanguage('en');
  });

  it('prints a dash rather than NaN or Infinity', () => {
    expect(num(Number.NaN, 2)).toBe('-');
    expect(int(Number.POSITIVE_INFINITY)).toBe('-');
  });
});

// The readouts used to concatenate English words around their numbers ("120 to 300 m",
// "(in mask)", "p(mine)"), which no locale could reach.
const SRC = join(__dirname, '..');
const LEAKS = [' to ${', '(in mask)', 'p(mine)', "'angle'"];

function uiSources(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const dir of ['components', 'pages']) {
    const d = join(SRC, dir);
    for (const f of readdirSync(d).filter((n) => n.endsWith('.tsx') && !n.includes('.test.'))) {
      out.push([`${dir}/${f}`, readFileSync(join(d, f), 'utf8')]);
    }
  }
  return out;
}

describe('the readouts have no English welded to them', () => {
  it('routes every word through the locale', () => {
    const bad: string[] = [];
    for (const [name, src] of uiSources()) {
      for (const leak of LEAKS) if (src.includes(leak)) bad.push(`${name}: ${leak}`);
    }
    expect(bad).toEqual([]);
  });

  it('formats displayed numbers through the formatter, not toFixed', () => {
    // toFixed is legitimate for an <input> value and for a CSS percentage; both are named here so a
    // new one has to be argued for rather than slipped in.
    const allowed = new Set(['components/Instrument.tsx']);
    const bad: string[] = [];
    for (const [name, src] of uiSources()) {
      const hits = src.split('\n').filter((l) => l.includes('.toFixed(')).length;
      if (hits > 0 && !allowed.has(name)) bad.push(`${name}: ${hits} toFixed`);
    }
    expect(bad).toEqual([]);
  });
});
