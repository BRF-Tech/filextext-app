import { defineConfig } from '@playwright/test';

// End-to-end against the fake host (dev/serve.mjs + dev/host.html), which
// serves dist/ exactly the way filex serves an app interface: another origin,
// a sandboxed frame, the generated CSP (no eval, connect-src 'none').
// Build first: `npm run build`.
const PORT = Number(process.env.FXTXT_E2E_PORT || 7301);

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node dev/serve.mjs --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    stdout: 'ignore',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', channel: 'chrome' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
