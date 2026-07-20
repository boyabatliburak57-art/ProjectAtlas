import { expect, test, type Page, type Route } from '@playwright/test';

const instrumentId = 'a1000000-0000-4000-8000-000000000001';
const cutoff = '2026-07-18T15:00:00.000Z';

test('market overview, rankings, sectors and partial freshness', async ({
  page,
}) => {
  await mockMarketApi(page);
  await page.goto('/market');

  await expect(
    page.getByRole('heading', { name: 'Piyasanın nabzı, tek kesimde.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Gecikmiş veri' }),
  ).toBeVisible();
  await expect(page.getByText('10 sembol hariç').first()).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'En çok yükselenler' }),
  ).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/symbols\/THYAO$/u),
    page.getByRole('link', { name: 'THYAO' }).first().click(),
  ]);
  await expect(page.getByRole('heading', { name: 'THYAO' })).toBeVisible();

  await page.goto('/market/sectors');
  await expect(
    page.getByRole('heading', { name: 'Para akışının yönü.' }),
  ).toBeVisible();
  await expect(page.getByText('Bankacılık').first()).toBeVisible();
  await expect(
    page.getByRole('link', { name: "Scanner'da aç" }).first(),
  ).toHaveAttribute('href', /sector=/u);
});

test('chart contract, adjustment payload, six overlays, markers and accessibility', async ({
  page,
}) => {
  const chartRequests: URL[] = [];
  await mockMarketApi(page, chartRequests);
  await page.goto('/symbols/THYAO');
  await page.getByRole('tab', { name: 'Grafik' }).click();
  await expect(
    page.getByRole('img', { name: /THYAO 1d grafiği/u }),
  ).toBeVisible();

  const finalChartResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === 'GET' &&
      url.pathname === '/api/v1/symbols/THYAO/chart' &&
      url.searchParams.get('timeframe') === '1w' &&
      url.searchParams.get('adjustmentMode') === 'split-adjusted' &&
      url.searchParams.get('overlays')?.split(',').length === 6
    );
  });
  await page.getByRole('button', { name: '1w' }).click();
  await page.getByLabel('Adjustment mode').selectOption('split-adjusted');
  await page.getByLabel('Bollinger').check();
  await page.getByLabel('MACD').check();
  await page.getByLabel('ATR').check();

  const finalChartResponse = await finalChartResponsePromise;
  expect(finalChartResponse.ok()).toBe(true);
  const finalRequest = new URL(finalChartResponse.url());
  expect(finalRequest.searchParams.get('adjustmentMode')).toBe(
    'split-adjusted',
  );
  expect(finalRequest.searchParams.get('overlays')?.split(',')).toHaveLength(6);
  expect(finalRequest.searchParams.get('includeCorporateActions')).toBe('true');
  expect(finalRequest.searchParams.get('includePatterns')).toBe('true');
  expect(finalRequest.searchParams.get('includeUserMarkers')).toBe('true');

  await expect(page.getByText(/Kurumsal aksiyon: 2:1 split/u)).toBeVisible();
  await expect(
    page.getByText(/Formasyon: DOUBLE_BOTTOM_CANDIDATE/u),
  ).toBeVisible();
  await expect(
    page.getByText(/Kullanıcı işareti: Kendi alarmım/u),
  ).toBeVisible();
  await expect(page.getByText('Başka kullanıcı işlemi')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Grafik metin özeti' }),
  ).toBeVisible();
  await expect(page.getByText(/Overlay:/u)).toContainText('SMA v1');

  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
  const unnamedButtons = await page
    .locator('button')
    .evaluateAll(
      (buttons) =>
        buttons.filter(
          (button) =>
            !button.textContent?.trim() &&
            !button.getAttribute('aria-label') &&
            !button.getAttribute('title'),
        ).length,
    );
  expect(unnamedButtons).toBe(0);
});

test('financial revisions, pattern evidence and product integrations', async ({
  page,
}) => {
  const actions = { watchlistPosts: 0, alertPosts: 0 };
  await mockMarketApi(page, [], actions);
  await page.goto('/symbols/THYAO');

  await page.getByRole('tab', { name: 'Finansallar' }).click();
  await expect(page.getByText('Yeniden düzenlendi').first()).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Oranlar ve metodoloji' }),
  ).toBeVisible();
  await expect(page.getByText('Hesaplanamadı').first()).toBeVisible();
  const quarterlyResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === 'GET' &&
      url.pathname === '/api/v1/symbols/THYAO/financials' &&
      url.searchParams.get('periodType') === 'quarterly'
    );
  });
  await Promise.all([
    quarterlyResponsePromise,
    page.getByRole('button', { name: 'Çeyreklik' }).click(),
  ]);
  await expect(page.getByRole('rowheader', { name: /2026-Q1/u })).toBeVisible();

  await page.getByRole('tab', { name: 'Formasyonlar' }).click();
  await expect(page.getByText('DOUBLE TOP CANDIDATE')).toBeVisible();
  await expect(page.getByText(/firstPivot: 120/u)).toBeVisible();
  await expect(
    page.getByText(/kesin tahmin veya yatırım tavsiyesi değildir/u),
  ).toBeVisible();

  await page.getByRole('tab', { name: 'Genel bakış' }).click();
  const watchlistButton = page.getByRole('button', {
    name: 'Watchlist’e ekle',
  });
  await watchlistButton.click();
  await expect(
    page.getByRole('button', { name: 'Watchlist’e eklendi' }),
  ).toBeDisabled();
  expect(actions.watchlistPosts).toBe(1);

  const alertButton = page.getByRole('button', { name: 'Alarm oluştur' });
  await alertButton.click();
  await expect(
    page.getByRole('button', { name: 'Alarm oluşturuldu' }),
  ).toBeDisabled();
  expect(actions.alertPosts).toBe(1);

  await Promise.all([
    page.waitForURL(/\/portfolios\?action=transaction&symbol=THYAO/u),
    page.getByRole('link', { name: 'Portföy işlemine aktar' }).click(),
  ]);
});

async function mockMarketApi(
  page: Page,
  chartRequests: URL[] = [],
  actions = { watchlistPosts: 0, alertPosts: 0 },
) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/notifications/unread-count')
      return envelope(route, { unreadCount: 2 });
    if (path === '/market/overview')
      return envelope(
        route,
        {
          indices: [
            {
              code: 'XU100',
              name: 'BIST 100',
              value: '11234.45',
              change: '135.20',
              changePercent: '1.22',
            },
            {
              code: 'XBANK',
              name: 'BIST Banka',
              value: '15750.10',
              change: '-42.20',
              changePercent: '-0.27',
            },
          ],
          marketState: 'Piyasa kapalı',
        },
        marketMeta(),
      );
    if (path === '/market/breadth')
      return envelope(
        route,
        {
          advancing: 365,
          declining: 252,
          unchanged: 23,
          evaluatedCount: 640,
          excludedCount: 10,
          universeCount: 650,
        },
        marketMeta(),
      );
    if (path === '/market/sectors')
      return envelope(route, { items: sectors() }, marketMeta());
    if (path.startsWith('/market/rankings/'))
      return envelope(
        route,
        { items: rankings(path.split('/').at(-1)!) },
        marketMeta(),
      );
    if (path === '/symbols/THYAO') return envelope(route, profile());
    if (path === '/symbols/THYAO/quote')
      return envelope(
        route,
        {
          price: '312.50',
          change: '4.20',
          changePercent: '1.36',
          high: '316.10',
          low: '306.20',
          volume: '18450000',
        },
        {
          dataCutoffAt: cutoff,
          stale: false,
          partial: false,
          quality: { status: 'accepted' },
        },
      );
    if (path === '/symbols/THYAO/chart') {
      chartRequests.push(url);
      return envelope(route, chart(url), {
        dataCutoffAt: cutoff,
        adjustmentMode: url.searchParams.get('adjustmentMode') ?? 'raw',
        indicatorVersions: Object.fromEntries(
          (url.searchParams.get('overlays') ?? '')
            .split(',')
            .filter(Boolean)
            .map((code) => [code, 1]),
        ),
        openBarIncluded: false,
      });
    }
    if (path === '/symbols/THYAO/financials')
      return envelope(route, financials(url.searchParams.get('periodType')));
    if (path === '/symbols/THYAO/ratios') return envelope(route, ratios());
    if (path === '/symbols/THYAO/financial-trends')
      return envelope(route, trends(url.searchParams.get('periodType')));
    if (path === '/symbols/THYAO/patterns') return envelope(route, patterns());
    if (path === '/watchlists' && request.method() === 'GET')
      return envelope(route, { items: [{ id: 'watchlist-1', name: 'Takip' }] });
    if (
      path === '/watchlists/watchlist-1/items' &&
      request.method() === 'POST'
    ) {
      actions.watchlistPosts += 1;
      return envelope(route, { id: 'item-1' }, {}, 201);
    }
    if (path === '/alerts' && request.method() === 'POST') {
      actions.alertPosts += 1;
      return envelope(route, { id: 'alert-1' }, {}, 201);
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: '{}',
    });
  });
}

function marketMeta() {
  return {
    generationId: 'generation-1',
    dataCutoffAt: cutoff,
    sourceTimestamp: cutoff,
    status: 'stale',
    partial: true,
    stale: true,
    evaluatedCount: 640,
    excludedCount: 10,
  };
}

function profile() {
  return {
    id: instrumentId,
    symbol: 'THYAO',
    name: 'Türk Hava Yolları',
    isin: 'TRATHYAO91M5',
    marketCode: 'BIST',
    currencyCode: 'TRY',
    status: 'active',
    sector: { code: 'ULAS', name: 'Ulaştırma' },
  };
}

function sectors() {
  return [
    sector('BANK', 'Bankacılık', '2.4', 18, 4, '7200000000'),
    sector('ULAS', 'Ulaştırma', '1.2', 8, 3, '4200000000'),
    sector('TEKN', 'Teknoloji', '-0.8', 4, 9, '1800000000'),
  ];
}

function sector(
  code: string,
  name: string,
  returnPercent: string,
  advancing: number,
  declining: number,
  volume: string,
) {
  return {
    sectorId: `sector-${code}`,
    sectorCode: code,
    sectorName: name,
    status: 'complete',
    partial: false,
    stale: false,
    evaluatedCount: advancing + declining,
    excludedCount: 0,
    returnPercent,
    breadthPercent: String((advancing / (advancing + declining)) * 100),
    advancing,
    declining,
    volume,
  };
}

function rankings(type: string) {
  const negative = type === 'losers';
  return [
    {
      instrumentId,
      symbol: 'THYAO',
      company: 'Türk Hava Yolları',
      rank: 1,
      sortValue: negative ? '-3.1' : '4.8',
      changePercent: negative ? '-3.1' : '4.8',
      status: 'complete',
    },
    {
      instrumentId: 'a1000000-0000-4000-8000-000000000002',
      symbol: 'ASELS',
      company: 'Aselsan',
      rank: 2,
      sortValue: negative ? '-2.2' : '3.7',
      changePercent: negative ? '-2.2' : '3.7',
      status: 'complete',
    },
  ];
}

function chart(url: URL) {
  const selected = (url.searchParams.get('overlays') ?? '')
    .split(',')
    .filter(Boolean);
  const panelCodes = new Set(['MACD', 'RSI', 'ATR']);
  const series = selected.map((code) => ({
    id: `${code.toLowerCase()}-1-value`,
    indicatorCode: code,
    indicatorVersion: 1,
    outputName: 'value',
    panel: panelCodes.has(code) ? code.toLowerCase() : 'price',
    points: bars().map((bar, index) => ({
      time: bar.time,
      value: String(300 + index),
    })),
  }));
  return {
    instrument: profile(),
    timeframe: url.searchParams.get('timeframe') ?? '1d',
    adjustmentMode: url.searchParams.get('adjustmentMode') ?? 'raw',
    bars: bars(),
    overlays: series.filter((item) => item.panel === 'price'),
    panels: series.filter((item) => item.panel !== 'price'),
    markers: [
      {
        time: bars()[4]!.time,
        type: 'corporateAction',
        label: '2:1 split',
        sourceType: 'provider',
      },
      {
        time: bars()[8]!.time,
        type: 'pattern',
        label: 'DOUBLE_BOTTOM_CANDIDATE',
        sourceType: 'pattern',
      },
      {
        time: bars()[10]!.time,
        type: 'alert',
        label: 'Kendi alarmım',
        sourceType: 'user',
        sourceId: 'owned-alert',
      },
    ],
    warnings: [],
  };
}

function bars() {
  return Array.from({ length: 20 }, (_, index) => ({
    time: 1782777600 + index * 86400,
    open: String(298 + index),
    high: String(303 + index),
    low: String(295 + index),
    close: String(300 + index + (index % 2 ? -1 : 2)),
    volume: String(1000000 + index * 50000),
    isClosed: true,
  }));
}

function financials(periodType: string | null) {
  if (periodType === 'quarterly')
    return [statement('2026-Q1', 'quarterly', 'q1-r1', '1200')];
  return [
    statement('2025-FY', 'annual', 'fy-r2', '5000'),
    statement('2025-FY', 'annual', 'fy-r1', '4800'),
    statement('2024-FY', 'annual', 'fy-2024-r1', '4100'),
  ];
}

function statement(
  period: string,
  periodType: string,
  revision: string,
  revenue: string,
) {
  return {
    period,
    periodType,
    periodStart: '2025-01-01T00:00:00.000Z',
    periodEnd: period.includes('Q1')
      ? '2026-03-31T00:00:00.000Z'
      : '2025-12-31T00:00:00.000Z',
    currencyCode: 'TRY',
    providerRevision: revision,
    publishedAt: cutoff,
    sourceTimestamp: cutoff,
    metrics: [
      { code: 'revenue', value: revenue, status: 'complete', reasonCode: null },
      {
        code: 'ebitda',
        value: null,
        status: 'missing',
        reasonCode: 'PROVIDER_METRIC_MISSING',
      },
      { code: 'netIncome', value: '850', status: 'complete', reasonCode: null },
    ],
  };
}

function ratios() {
  return [
    {
      code: 'pe',
      value: '8.4',
      status: 'complete',
      reasonCode: null,
      formulaVersion: 'fundamentals-ratios-v1',
    },
    {
      code: 'evEbitda',
      value: null,
      status: 'not_evaluable',
      reasonCode: 'METRIC_MISSING',
      formulaVersion: 'fundamentals-ratios-v1',
    },
  ];
}

function trends(periodType: string | null) {
  return (
    periodType === 'quarterly' ? financials('quarterly') : financials('annual')
  ).map((item) => ({
    period: item.period,
    periodEnd: item.periodEnd,
    value: item.metrics[0]!.value,
    status: 'complete',
    reasonCode: null,
    providerRevision: item.providerRevision,
  }));
}

function patterns() {
  return [
    {
      id: 'pattern-1',
      instrumentId,
      symbol: 'THYAO',
      code: 'DOUBLE_TOP_CANDIDATE',
      algorithmVersion: 'double-top-v1',
      state: 'candidate',
      direction: 'bearish',
      startTime: '2026-07-01T00:00:00.000Z',
      endTime: cutoff,
      detectedAt: cutoff,
      dataCutoffAt: cutoff,
      confidence: null,
      evidence: {
        points: [
          {
            time: '2026-07-08T00:00:00.000Z',
            price: '120',
            role: 'firstPivot',
          },
          {
            time: '2026-07-16T00:00:00.000Z',
            price: '119',
            role: 'secondPivot',
          },
        ],
      },
      warnings: [],
    },
  ];
}

function envelope(
  route: Route,
  data: unknown,
  meta: unknown = {},
  status = 200,
) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ data, meta }),
  });
}
