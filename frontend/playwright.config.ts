import { defineConfig } from '@playwright/test';

// The visual gates run against the BUILT site (vite preview), never the dev server, so what is measured
// is what ships. Browsers live in the Playwright cache set by PLAYWRIGHT_BROWSERS_PATH.
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.RAJO_BASE_URL ?? 'http://localhost:4173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: process.env.RAJO_BASE_URL
    ? undefined
    : {
        command: 'npm run preview',
        url: 'http://localhost:4173',
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
