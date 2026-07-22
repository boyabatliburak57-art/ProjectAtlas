import { expect, test } from '@playwright/test';

const flag = {
  description: 'Stop creation of new scanner runs',
  expiresAt: null,
  flagType: 'kill_switch',
  id: '00000000-0000-4000-8000-000000007701',
  key: 'scanner.new-runs.disabled',
  owner: 'scanner-runtime',
};

test('operations admin sees platform state and submits an audited kill switch command', async ({
  page,
}) => {
  let command: Record<string, unknown> | undefined;
  await page.route('**/api/v1/admin/operations/overview', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          backup: { status: 'healthy' },
          incidents: [],
          queues: [
            {
              counts: { failed: 0, waiting: 2 },
              name: 'scanner',
              paused: false,
            },
          ],
          recovery: [{ status: 'passed' }],
          releases: [{ status: 'healthy' }],
        },
      }),
    }),
  );
  await page.route('**/api/v1/admin/feature-flags', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { expired: [], items: [flag] } }),
    }),
  );
  await page.route(
    `**/api/v1/admin/feature-flags/${flag.key}/history`,
    (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            flag,
            versions: [{ enabled: false, environment: 'test', version: 1 }],
          },
        }),
      }),
  );
  await page.route(
    `**/api/v1/admin/maintenance/kill-switches/${flag.key}/enable`,
    async (route) => {
      command = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ data: { enabled: true, version: 2 } }),
      });
    },
  );

  await page.goto('/admin/operations');
  await expect(
    page.getByRole('heading', { name: 'Platform durumu ve güvenli müdahale.' }),
  ).toBeVisible();
  await expect(page.getByRole('table', { name: 'Queue status' })).toContainText(
    'scanner',
  );
  const switches = page.getByRole('region', {
    name: 'Feature flags ve kill switches',
  });
  await switches.getByLabel('Confirmation').fill('ENABLE_KILL_SWITCH');
  await switches.getByRole('button', { name: 'Enable' }).click();
  await expect
    .poll(() => command)
    .toMatchObject({
      confirmation: 'ENABLE_KILL_SWITCH',
      expectedVersion: 1,
      reason: 'Controlled incident mitigation',
    });
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
});

test('non-admin receives a safe denied state without operational data', async ({
  page,
}) => {
  await page.route('**/api/v1/admin/**', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'ADMIN_SCOPE_REQUIRED' } }),
    }),
  );
  await page.goto('/admin/operations');
  await expect(
    page.getByRole('alert').filter({ hasText: 'Admin yetkisi gerekli' }),
  ).toContainText('Admin yetkisi gerekli');
  await expect(page.getByRole('table')).toHaveCount(0);
});
