import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @atlas/api e2e:scanner',
      url: 'http://127.0.0.1:3001/api/v1/scanner/operators',
      reuseExistingServer: false,
    },
    {
      command:
        'pnpm --config.engine-strict=false build && pnpm --config.engine-strict=false start --hostname 127.0.0.1 --port 3100',
      url: 'http://127.0.0.1:3100/scanner',
      reuseExistingServer: false,
      env: { NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001/api/v1' },
    },
  ],
});
