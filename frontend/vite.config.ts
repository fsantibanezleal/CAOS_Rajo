import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The site is served from the domain root (vps-static), so base stays '/'.
export default defineConfig({
  plugins: [react()],
  base: '/',
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
