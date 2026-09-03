import { describe, expect, it } from 'vitest';

import { terrariumToMetres } from './basemap';

describe('terrarium decoding', () => {
  it('decodes sea level and a mountain', () => {
    expect(terrariumToMetres(128, 0, 0)).toBe(0);
    // 2 800 m: 32768 + 2800 = 35568 = 138 * 256 + 240
    expect(terrariumToMetres(138, 240, 0)).toBe(2800);
    expect(terrariumToMetres(127, 255, 0)).toBe(-1);
  });
});
