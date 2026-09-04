import { defineConfig } from '@playwright/test';

// The visual gates run against the BUILT site (vite preview), never the dev server, so what is measured
// is what ships. Browsers live in the Playwright cache set by PLAYWRIGHT_BROWSERS_PATH.
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  retries: 0,
  // one worker: the map is GPU-bound in headless Chromium and two parallel contexts lose the WebGL context
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.RAJO_BASE_URL ?? 'http://localhost:4901',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: process.env.RAJO_BASE_URL
    ? undefined
    : {
        command: 'npm run preview',
        url: 'http://localhost:4901',
        // never reuse a server this config did not start: a listening port may belong to another product
        reuseExistingServer: false,
        timeout: 60_000,
      },
});
