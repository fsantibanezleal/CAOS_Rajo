import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// the display version comes from the repository's VERSION file at build time (the footer, the About
// page and the citation print it); a hardcoded copy shipped 0.01.000 on the 0.02.000 deploy
const VERSION = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'VERSION'), 'utf8').trim();

// The site is served from the domain root (vps-static), so base stays '/'.
export default defineConfig({
  plugins: [react()],
  base: '/',
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  // Rajo's registered local ports (CAOS_MANAGE repos/registry.yaml dev_ports): strict, never fall through
  // to a neighbour's port.
  server: { port: 5901, strictPort: true },
  preview: { port: 4901, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ['maplibre-gl'],
        },
      },
    },
  },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
