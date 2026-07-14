import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @atlas/api e2e:scanner',
      url: 'http://127.0.0.1:3001/api/v1/scanner/operators',
      reuseExistingServer: !process.env.CI,
    },
    {
      command:
        'pnpm --config.engine-strict=false dev --hostname 127.0.0.1 --port 3100',
      url: 'http://127.0.0.1:3100/scanner',
      reuseExistingServer: !process.env.CI,
      env: { NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001/api/v1' },
    },
  ],
});
