// A histogram on a 2D canvas with a hover readout (bin range and count), the current display range shaded,
// and an optional threshold line. Theme-aware through the CSS tokens read at draw time.
import { useEffect, useRef, useState } from 'react';

export interface HistogramProps {
  counts: Uint32Array | number[];
  lo: number;
  hi: number;
  rangeLo?: number;
  rangeHi?: number;
  threshold?: number;
  height?: number;
  format?: (v: number) => string;
}

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

export function Histogram({ counts, lo, hi, rangeLo, rangeHi, threshold, height = 96, format = (v) => v.toFixed(3) }: HistogramProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<{ x: number; bin: number } | null>(null);
  const bins = counts.length;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    let max = 1;
    for (let i = 0; i < bins; i++) max = Math.max(max, counts[i]!);
    const bw = w / bins;
    const x = (v: number) => ((v - lo) / (hi - lo || 1e-9)) * w;
    if (rangeLo !== undefined && rangeHi !== undefined) {
      ctx.fillStyle = token('--accent-soft');
      ctx.fillRect(x(rangeLo), 0, Math.max(1, x(rangeHi) - x(rangeLo)), h);
    }
    ctx.fillStyle = token('--fg-muted');
    for (let i = 0; i < bins; i++) {
      const bh = (counts[i]! / max) * (h - 14);
      ctx.fillRect(i * bw, h - 12 - bh, Math.max(1, bw - 0.5), bh);
    }
    if (hover) {
      ctx.fillStyle = token('--accent');
      const bh = (counts[hover.bin]! / max) * (h - 14);
      ctx.fillRect(hover.bin * bw, h - 12 - bh, Math.max(1, bw - 0.5), bh);
    }
    if (threshold !== undefined && Number.isFinite(threshold)) {
      ctx.strokeStyle = token('--cyan');
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x(threshold), 0);
      ctx.lineTo(x(threshold), h - 12);
      ctx.stroke();
    }
    ctx.fillStyle = token('--fg-faint');
    ctx.font = '10px ' + token('--font-mono');
    ctx.textAlign = 'left';
    ctx.fillText(format(lo), 2, h - 2);
    ctx.textAlign = 'right';
    ctx.fillText(format(hi), w - 2, h - 2);
  }, [counts, lo, hi, rangeLo, rangeHi, threshold, height, hover, bins, format]);

  const binLo = hover ? lo + (hover.bin / bins) * (hi - lo) : 0;
  const binHi = hover ? lo + ((hover.bin + 1) / bins) * (hi - lo) : 0;
  return (
    <div className="hist" data-testid="histogram">
      <canvas
        ref={ref}
        style={{ width: '100%', height }}
        onMouseMove={(e) => {
          const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
          const bin = Math.min(bins - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * bins)));
          setHover({ x: e.clientX - r.left, bin });
        }}
        onMouseLeave={() => setHover(null)}
      />
      <div className="hist-read mono">
        {hover ? `${format(binLo)} to ${format(binHi)}: ${counts[hover.bin]!.toLocaleString()} px` : ' '}
      </div>
    </div>
  );
}
