import { expect, test, type Page, type Route } from '@playwright/test';

const instrumentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const savedScanId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const watchlistId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

interface MockState {
  alertSequence: number;
  watchlists: Array<Record<string, unknown>>;
  alerts: Array<Record<string, unknown>>;
  notifications: Array<Record<string, unknown>>;
  preferences: Record<string, unknown>;
}

function state(): MockState {
  return {
    alertSequence: 0,
    watchlists: [],
    alerts: [],
    notifications: [],
    preferences: {
      timezone: 'Europe/Istanbul',
      locale: 'tr-TR',
      emailAlertsEnabled: true,
      dailyDigestEnabled: false,
      scanCompletionEnabled: true,
      quietHoursEnabled: false,
      quietHoursStartMinute: null,
      quietHoursEndMinute: null,
      throttleMinutes: 0,
    },
  };
}

async function json(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ data, meta: { requestId: 'portfolio-e2e' } }),
  });
}

async function mockPortfolio(page: Page, fixture: MockState) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    const method = request.method();

    if (path === '/watchlists' && method === 'GET') {
      return json(route, { items: fixture.watchlists });
    }
    if (path === '/watchlists' && method === 'POST') {
      const input = request.postDataJSON() as {
        name: string;
        description?: string;
      };
      const watchlist = {
        id: watchlistId,
        name: input.name,
        description: input.description ?? null,
        status: 'active',
        items: [],
        updatedAt: '2026-07-16T08:00:00.000Z',
      };
      fixture.watchlists = [watchlist];
      return json(route, watchlist, 201);
    }
    if (path === `/watchlists/${watchlistId}/items` && method === 'POST') {
      const input = request.postDataJSON() as {
        instrumentId: string;
        note?: string;
      };
      const current = fixture.watchlists[0]!;
      const updated = {
        ...current,
        items: [
          {
            id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            instrumentId: input.instrumentId,
            note: input.note ?? null,
            tags: [],
            sortOrder: 0,
          },
        ],
      };
      fixture.watchlists = [updated];
      return json(route, updated, 201);
    }
    if (
      path === `/watchlists/${watchlistId}/market-summary` &&
      method === 'GET'
    ) {
      const items = (fixture.watchlists[0]?.items as unknown[] | undefined)
        ?.length
        ? [
            {
              instrumentId,
              symbol: 'THYAO',
              company: 'Türk Hava Yolları',
              lastPrice: '312.500000',
              dailyChangePercent: '2.400000',
              dataTime: '2026-07-16T08:00:00.000Z',
              stale: false,
              activeAlertCount: fixture.alerts.length,
            },
          ]
        : [];
      return json(route, { watchlistId, items });
    }

    if (path === '/alerts' && method === 'GET')
      return json(route, fixture.alerts);
    if (path === '/alerts' && method === 'POST') {
      const input = request.postDataJSON() as Record<string, unknown>;
      fixture.alertSequence += 1;
      const alert = {
        id: `eeeeeeee-eeee-4eee-8eee-${String(fixture.alertSequence).padStart(12, '0')}`,
        name: input.name,
        status: 'active',
        currentRevision: 1,
        revision: {
          source: input.source,
          triggerPolicy: input.triggerPolicy,
          repeatPolicy: input.repeatPolicy,
          timeframe: input.timeframe,
          sourceConfiguration: input.sourceConfiguration,
          channels: input.channels,
        },
        updatedAt: '2026-07-16T08:00:00.000Z',
      };
      fixture.alerts = [alert, ...fixture.alerts];
      return json(route, alert, 201);
    }
    const lifecycle = path.match(/^\/alerts\/([^/]+)\/(pause|resume)$/);
    if (lifecycle && method === 'POST') {
      const [, id, action] = lifecycle;
      const alert = fixture.alerts.find((item) => item.id === id)!;
      alert.status = action === 'pause' ? 'paused' : 'active';
      return json(route, alert);
    }

    if (path === '/test/fixture-event' && method === 'POST') {
      const priceAlert = fixture.alerts.find(
        (item) =>
          (item.revision as { source: { type: string } }).source.type ===
          'instrument_price',
      );
      fixture.notifications = [
        {
          id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          type: 'alertTriggered',
          title: priceAlert?.name ?? 'THYAO fiyat alarmı',
          body: 'THYAO fiyatı 310,00 ₺ eşiğini geçti. Veri zamanı 11:00.',
          metadata: { symbol: 'THYAO', alertId: priceAlert?.id },
          readAt: null,
          occurredAt: '2026-07-16T08:00:00.000Z',
        },
      ];
      return json(route, { accepted: true });
    }
    if (path === '/notifications/unread-count' && method === 'GET') {
      return json(route, {
        unreadCount: fixture.notifications.filter(
          (item) => item.readAt === null,
        ).length,
      });
    }
    if (path === '/notifications' && method === 'GET') {
      const unreadOnly = url.searchParams.get('unread') === 'true';
      return json(
        route,
        unreadOnly
          ? fixture.notifications.filter((item) => item.readAt === null)
          : fixture.notifications,
      );
    }
    const notificationAction = path.match(
      /^\/notifications\/([^/]+)\/(read|unread)$/,
    );
    if (notificationAction && method === 'POST') {
      const [, id, action] = notificationAction;
      const notification = fixture.notifications.find(
        (item) => item.id === id,
      )!;
      notification.readAt =
        action === 'read' ? '2026-07-16T08:05:00.000Z' : null;
      return json(route, notification);
    }
    if (path === '/notifications/mark-all-read' && method === 'POST') {
      const updatedCount = fixture.notifications.filter(
        (item) => item.readAt === null,
      ).length;
      fixture.notifications.forEach((item) => {
        item.readAt = '2026-07-16T08:05:00.000Z';
      });
      return json(route, { updatedCount });
    }
    if (path === '/notification-preferences' && method === 'GET') {
      return json(route, fixture.preferences);
    }
    if (path === '/notification-preferences' && method === 'PUT') {
      fixture.preferences = request.postDataJSON() as Record<string, unknown>;
      return json(route, fixture.preferences);
    }
    return route.fulfill({ status: 404, body: '{}' });
  });
}

test('watchlist, alert trigger, notification ve lifecycle akışı', async ({
  page,
}) => {
  const fixture = state();
  await mockPortfolio(page, fixture);

  await page.goto('/watchlists');
  await page.getByRole('button', { name: 'Yeni watchlist' }).click();
  await page.getByLabel('Liste adı').fill('Ana takip');
  await page.getByLabel('Açıklama').fill('Likiditesi yüksek semboller');
  await page.getByRole('button', { name: 'Watchlist oluştur' }).click();
  await expect(page.getByRole('heading', { name: 'Ana takip' })).toBeVisible();

  await page.getByLabel('Enstrüman kimliği').fill(instrumentId);
  await page.getByLabel('Not').fill('Bilanço sonrası izle');
  await page.getByRole('button', { name: 'Sembol ekle' }).click();
  await expect(
    page.getByRole('cell', { name: 'THYAO Türk Hava Yolları' }),
  ).toBeVisible();
  await expect(page.getByText('Güncel')).toBeVisible();

  await Promise.all([
    page.waitForURL(/\/alerts$/u),
    page.getByRole('link', { name: 'Alarmlar' }).click(),
  ]);
  await page.getByRole('button', { name: 'Fiyat alarmı' }).click();
  await page.getByLabel('Alarm adı').fill('THYAO 310 üstü');
  await page.getByLabel('Enstrüman kimliği').fill(instrumentId);
  await page.getByLabel('Eşik (₺)').fill('310');
  await page.getByRole('button', { name: 'Alarm oluştur' }).click();
  await expect(page.getByText('THYAO 310 üstü')).toBeVisible();

  await page.evaluate(async () => {
    await fetch('http://127.0.0.1:3001/api/v1/test/fixture-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  });
  await Promise.all([
    page.waitForURL(/\/notifications$/u),
    page.getByRole('link', { name: /Bildirimler/ }).click(),
  ]);
  await expect(
    page.getByRole('heading', { name: 'THYAO 310 üstü' }),
  ).toBeVisible();
  await expect(page.getByText('Alarm tetiklendi')).toBeVisible();
  await expect(page.getByLabel('1 okunmamış bildirim')).toBeVisible();
  const readResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/read'),
  );
  await Promise.all([
    readResponsePromise,
    page
      .getByRole('button', { name: 'THYAO 310 üstü bildirimini okundu yap' })
      .click(),
  ]);
  await expect(
    page.getByRole('button', {
      name: 'THYAO 310 üstü bildirimini okunmadı yap',
    }),
  ).toBeVisible();

  await Promise.all([
    page.waitForURL(/\/alerts$/u),
    page.getByRole('link', { name: 'Alarmlar' }).click(),
  ]);
  await page.getByRole('button', { name: 'NewMatch alarmı' }).click();
  await page.getByLabel('Alarm adı').fill('Yeni RSI eşleşmeleri');
  await page.getByLabel('Saved scan kimliği').fill(savedScanId);
  await page.getByLabel('Saved scan revision').fill('1');
  await page.getByRole('button', { name: 'Alarm oluştur' }).click();
  await expect(page.getByText('Saved scan · yeni eşleşme')).toBeVisible();
  const pauseResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/pause'),
  );
  await Promise.all([
    pauseResponsePromise,
    page
      .getByRole('button', { name: 'Yeni RSI eşleşmeleri alarmını duraklat' })
      .click(),
  ]);
  await expect(page.getByText('Duraklatıldı')).toBeVisible();
  const resumeResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/resume'),
  );
  await Promise.all([
    resumeResponsePromise,
    page
      .getByRole('button', {
        name: 'Yeni RSI eşleşmeleri alarmını devam ettir',
      })
      .click(),
  ]);
  await expect(page.getByText('Aktif').first()).toBeVisible();
});

test('notification preferences saat dilimi ve quiet hours ile kaydedilir', async ({
  page,
}) => {
  const fixture = state();
  await mockPortfolio(page, fixture);
  await page.goto('/notification-preferences');
  await page.getByLabel('Saat dilimi').selectOption('UTC');
  await page.getByLabel('Sessiz saatleri etkinleştir').check();
  await page.getByLabel('Başlangıç').fill('22:30');
  await page.getByLabel('Bitiş').fill('07:30');
  await page.getByRole('button', { name: 'Değişiklikleri kaydet' }).click();
  await expect(page.getByText('Tercihler kaydedildi.')).toBeVisible();
  expect(fixture.preferences).toMatchObject({
    timezone: 'UTC',
    quietHoursEnabled: true,
    quietHoursStartMinute: 1350,
    quietHoursEndMinute: 450,
  });
});
