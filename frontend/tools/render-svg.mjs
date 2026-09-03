// Render a hand-authored themed, bilingual architecture SVG inside Rajo's own palette and screenshot it in
// both themes and both languages (ADR-0058: author, render, look, fix). The SVG is inlined into a page that
// loads src/styles/tokens.css and sets data-theme and data-arch-lang exactly as the modal does.
//
//   node tools/render-svg.mjs --svg public/svg/tech/02-lanes.svg --out E:/_Temp/rajo/svg-check
//   node tools/render-svg.mjs --all --out E:/_Temp/rajo/svg-check
//
// Needs Playwright's Chromium (PLAYWRIGHT_BROWSERS_PATH as for the gates).
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const all = process.argv.includes('--all');
const out = resolve(arg('out', join(ROOT, 'build', 'svg-check')));
const files = all ? readdirSync(join(ROOT, 'public', 'svg', 'tech')).filter((f) => f.endsWith('.svg')).map((f) => join(ROOT, 'public', 'svg', 'tech', f)) : [resolve(arg('svg', ''))];
if (!files[0] || !existsSync(files[0])) {
  console.error('need --svg <file> or --all');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const tokens = readFileSync(join(ROOT, 'src', 'styles', 'tokens.css'), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
let problems = 0;
for (const file of files) {
  const svg = readFileSync(file, 'utf8');
  const hex = (svg.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).filter((h) => !/^#(8594|8804|215|8805|8722)$/.test(h.replace('&', '')));
  if (hex.length) {
    console.log(`HEX in ${basename(file)}: ${[...new Set(hex)].join(' ')}`);
    problems++;
  }
  for (const theme of ['light', 'dark']) {
    for (const lang of ['en', 'es']) {
      const html = `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><style>${tokens}
        body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--font-sans,system-ui)}
        .wrap{padding:20px;width:960px}
        .arch-modal[data-arch-lang="en"] .l-es{display:none}.arch-modal[data-arch-lang="es"] .l-en{display:none}
        svg{width:100%;height:auto;display:block}</style></head>
        <body><div class="wrap arch-modal" data-arch-lang="${lang}">${svg}</div></body></html>`;
      await page.setContent(html, { waitUntil: 'load' });
      // text that leaves its viewBox or the drawing area is a defect: measure every visible text node
      const report = await page.evaluate(() => {
        const svgEl = document.querySelector('svg');
        const vb = svgEl.viewBox.baseVal;
        const r = svgEl.getBoundingClientRect();
        const sx = r.width / vb.width;
        const outOf = [];
        // a text must stay inside its viewBox AND inside the box it starts in (no text crossing a box edge)
        const rects = [...svgEl.querySelectorAll('rect')].map((r) => ({ x: r.x.baseVal.value, y: r.y.baseVal.value, w: r.width.baseVal.value, h: r.height.baseVal.value }));
        for (const t of svgEl.querySelectorAll('text')) {
          if (getComputedStyle(t).display === 'none') continue;
          const b = t.getBBox();
          if (b.x < 0 || b.y < 0 || b.x + b.width > vb.width + 0.5 || b.y + b.height > vb.height + 0.5) outOf.push(`${t.textContent.slice(0, 40)} (${Math.round(b.x + b.width)},${Math.round(b.y + b.height)})`);
          const inside = rects.filter((r) => b.x >= r.x && b.x <= r.x + r.w && b.y + b.height / 2 >= r.y && b.y + b.height / 2 <= r.y + r.h);
          if (inside.length) {
            const tight = inside.reduce((a, r) => (r.w * r.h < a.w * a.h ? r : a));
            // three pixels of slack: a glyph's advance width can exceed its ink by that much
            if (b.x + b.width > tight.x + tight.w + 3) outOf.push(`crosses box: ${t.textContent.slice(0, 40)} (+${Math.round(b.x + b.width - tight.x - tight.w)}px)`);
          }
        }
        return { outOf, scale: sx, n: svgEl.querySelectorAll('text').length };
      });
      const png = join(out, `${basename(file, '.svg')}-${theme}-${lang}.png`);
      await page.locator('svg').screenshot({ path: png });
      if (report.outOf.length) {
        console.log(`OUT OF VIEWBOX in ${basename(file)} [${theme}/${lang}]: ${report.outOf.slice(0, 6).join(' | ')}`);
        problems++;
      }
      console.log(`${basename(file)} ${theme}/${lang}: ${report.n} text nodes, ${report.outOf.length} out of viewBox -> ${png}`);
    }
  }
}
await browser.close();
process.exit(problems ? 1 : 0);
