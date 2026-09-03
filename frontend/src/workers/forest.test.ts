// The forest the browser traverses must return scikit-learn's predict_proba. The fixture carries the
// golden chip's feature planes and the Python traversal of the shipped forest file (make_golden.py,
// whose traversal is parity-checked against scikit-learn by export_forest.py); this test walks the
// same file in TypeScript and compares pixel for pixel.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import golden from './__fixtures__/rf_features_golden.json';
import { RF_FEATURES } from './features';
import { forestProb, parseForest } from './forest';

type Golden = {
  width: number;
  height: number;
  features: string[];
  planes: Record<string, number[]>;
  forest: { file: string; n_trees: number; n_nodes: number };
  rf_prob: number[];
};
const g = golden as unknown as Golden;

function loadShippedForest() {
  const buf = readFileSync(resolve(__dirname, '../../..', g.forest.file));
  return parseForest(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

describe('the flat-array forest', () => {
  it('parses the shipped file with the registry shape', () => {
    const f = loadShippedForest();
    expect(f.nTrees).toBe(g.forest.n_trees);
    expect(f.nNodes).toBe(g.forest.n_nodes);
    expect(f.nFeatures).toBe(RF_FEATURES.length);
    expect(f.features).toEqual([...RF_FEATURES]);
    expect(f.offsets.length).toBe(f.nTrees);
    expect(f.offsets[0]).toBe(0);
    expect(f.feature.length).toBe(f.nNodes);
    expect(f.threshold.length).toBe(f.nNodes);
    // every leaf carries a probability, every inner node a feature index inside the stack (counted in
    // one pass: 247k nodes with an expect() each ran past the 5 s test budget on a loaded machine)
    let leaves = 0;
    let badLeaf = 0;
    let badInner = 0;
    for (let i = 0; i < f.nNodes; i++) {
      if (f.feature[i]! < 0) {
        leaves++;
        if (f.left[i] !== -1 || !(f.value[i]! >= 0 && f.value[i]! <= 1)) badLeaf++;
      } else if (f.feature[i]! >= f.nFeatures || f.left[i]! <= i || f.right[i]! <= i) {
        badInner++;
      }
    }
    expect(badLeaf).toBe(0);
    expect(badInner).toBe(0);
    expect(leaves).toBeGreaterThan(f.nTrees);
  });

  it('matches the Python traversal on the golden chip to 1e-6', () => {
    const f = loadShippedForest();
    const n = g.width * g.height;
    const planes = f.features.map((name) => Float32Array.from(g.planes[name]!));
    const calls: number[] = [];
    const prob = forestProb(f, planes, n, (done) => calls.push(done));
    expect(prob.length).toBe(n);
    expect(calls.at(-1)).toBe(n);
    let worst = 0;
    for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(prob[i]! - g.rf_prob[i]!));
    expect(worst).toBeLessThan(1e-6);
    // the chip is not degenerate: the bare block and the vegetation get different answers
    const spread = Math.max(...prob) - Math.min(...prob);
    expect(spread).toBeGreaterThan(0.05);
  });

  it('refuses a file that is not a forest', () => {
    expect(() => parseForest(new TextEncoder().encode('<!doctype html>').buffer as ArrayBuffer)).toThrow(/not a Rajo forest/);
  });
});
