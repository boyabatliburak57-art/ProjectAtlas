import { expect, test, type Page, type Route } from '@playwright/test';

const rule = {
  version: 1,
  universe: {
    market: 'BIST',
    statuses: ['active'],
    indexCodes: ['XU100'],
    sectorIds: [],
  },
  root: {
    type: 'group',
    nodeId: 'group-root',
    operator: 'AND',
    children: [
      {
        type: 'condition',
        nodeId: 'condition-rsi',
        operator: 'LT',
        left: {
          type: 'indicator',
          code: 'RSI',
          version: 1,
          timeframe: '1d',
          parameters: { period: 14 },
        },
        right: { type: 'constantNumber', value: 30 },
      },
    ],
  },
};

const progress = {
  total: 100,
  processed: 100,
  matched: 2,
  notEvaluable: 1,
  warnings: 1,
  phase: 'completed',
  percent: 100,
  stale: false,
  terminal: true,
  pollAfterMs: null,
};

const run = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'completed',
  progress,
  dataCutoffAt: '2026-07-14T08:00:00.000Z',
  errorCode: null,
};

async function json(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ data, meta: { requestId: 'e2e' } }),
  });
}

async function mockScanner(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith('/indicators'))
      return json(route, {
        items: [
          {
            code: 'RSI',
            version: 1,
            name: 'Relative Strength Index',
            category: 'momentum',
            status: 'enabled',
            parameters: { period: { default: 14 } },
            output: { kind: 'scalar' },
          },
        ],
        total: 1,
      });
    if (path.endsWith('/scanner/operators'))
      return json(route, [
        {
          code: 'GT',
          arity: 2,
          valueType: 'number',
          historyRequirement: 'none',
        },
        {
          code: 'LT',
          arity: 2,
          valueType: 'number',
          historyRequirement: 'none',
        },
        {
          code: 'BETWEEN',
          arity: 3,
          valueType: 'number',
          historyRequirement: 'none',
        },
      ]);
    if (path.endsWith('/preset-scans') && route.request().method() === 'GET')
      return json(route, [
        {
          id: 'preset-1',
          code: 'RSI_OVERSOLD',
          name: 'RSI Aşırı Satım',
          description: 'RSI 30 altında',
          revision: 3,
        },
      ]);
    if (path.endsWith('/preset-scans/RSI_OVERSOLD'))
      return json(route, {
        id: 'preset-1',
        code: 'RSI_OVERSOLD',
        name: 'RSI Aşırı Satım',
        description: 'RSI 30 altında',
        revision: 3,
        rule,
      });
    if (path.endsWith('/scanner/validate'))
      return json(route, {
        valid: true,
        normalizedRule: rule,
        errors: [],
        warnings: [],
        complexity: {
          score: 1240,
          nodeCount: 2,
          uniqueIndicatorCount: 1,
          warmupBars: 14,
        },
        executionMode: 'sync',
        timeframes: ['1d'],
      });
    if (
      (path.endsWith('/preset-scans/RSI_OVERSOLD/runs') ||
        path.endsWith('/scanner/runs')) &&
      route.request().method() === 'POST'
    ) {
      expect(route.request().headers()['idempotency-key']).toBeTruthy();
      return json(
        route,
        {
          ...run,
          status: 'queued',
          progress: {
            ...progress,
            processed: 0,
            matched: 0,
            notEvaluable: 0,
            percent: 0,
            phase: 'queued',
            terminal: false,
            pollAfterMs: 750,
          },
        },
        201,
      );
    }
    if (path.endsWith(`/scanner/runs/${run.id}/results`))
      return json(route, {
        items: [
          {
            id: 'result-1',
            instrumentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            rank: 1,
            status: 'matched',
            computedValues: {
              symbol: 'THYAO',
              companyName: 'Türk Hava Yolları',
              lastPrice: 312.5,
              changePercent: 2.4,
              volume: 12000000,
              relativeVolume: 1.8,
              RSI: 27.4,
            },
            explanation: { 'condition-rsi': '27.4 < 30 · doğru' },
            warnings: [],
            dataCutoffAt: run.dataCutoffAt,
          },
          {
            id: 'result-2',
            instrumentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            rank: null,
            status: 'notEvaluable',
            computedValues: { symbol: 'TEST', companyName: 'Eksik Veri A.Ş.' },
            explanation: { 'condition-rsi': 'warm-up verisi yetersiz' },
            warnings: [{ code: 'WARMUP_INSUFFICIENT' }],
            dataCutoffAt: run.dataCutoffAt,
          },
        ],
      });
    if (path.endsWith(`/scanner/runs/${run.id}`)) return json(route, run);
    return route.fulfill({ status: 404, body: '{}' });
  });
}

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title.includes('AST round-trip')) {
    await page.route('**/api/v1/preset-scans', (route) => json(route, []));
  } else {
    await mockScanner(page);
  }
  await page.goto('/scanner', { waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('heading', { name: 'Kural oluşturucu' }),
  ).toBeVisible();
});

test('hazır tarama yüklenir, çalışır ve açıklama açılır', async ({ page }) => {
  await page.getByRole('button', { name: 'Hazır taramalar' }).click();
  await page.getByRole('button', { name: /RSI Aşırı Satım/ }).click();
  await expect(
    page.getByText(/Hazır tarama · RSI Aşırı Satım · r3/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Taramayı çalıştır' }).click();
  await expect(
    page.getByRole('heading', { name: 'Tarama tamamlandı.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'THYAO Türk Hava Yolları' }),
  ).toBeVisible();
  await expect(page.getByText('Değerlendirilemedi').first()).toBeVisible();
  await page.getByRole('button', { name: 'THYAO açıklamasını aç' }).click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'THYAO' }),
  ).toBeVisible();
  await expect(page.getByText('27.4 < 30 · doğru')).toBeVisible();
});

test('özel tarama düzenlenir, sunucuda doğrulanır ve çalışır', async ({
  page,
}) => {
  await page.getByLabel('Operatör').selectOption('LT');
  await page.getByLabel('Karşılaştırma değeri').fill('35');
  await page.getByRole('button', { name: 'Sunucuda doğrula' }).click();
  await expect(
    page.getByRole('heading', { name: 'Kural çalışmaya hazır.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Taramayı çalıştır' }).click();
  await expect(
    page.getByRole('heading', { name: 'Tarama tamamlandı.' }),
  ).toBeVisible();
  await expect(page.getByText('2 eşleşme')).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'TEST Eksik Veri A.Ş.' }),
  ).toBeVisible();
});

test('özel tarama AST round-trip gerçek scanner API üzerinden korunur', async ({
  page,
}) => {
  const rows = page.locator('.condition-row');
  const rsi = rows.nth(0);
  await rsi.getByLabel('İndikatör').selectOption('RSI:1');
  await rsi.getByLabel('Sol periyot').fill('14');
  await rsi.getByLabel('Zaman dilimi').selectOption('1d');
  await rsi.getByLabel('Operatör').selectOption('LT');
  await rsi.getByLabel('Karşılaştırma değeri').fill('35');

  await page.getByRole('button', { name: '+ Koşul' }).click();
  const emaCross = rows.nth(1);
  await emaCross.getByLabel('İndikatör').selectOption('EMA:1');
  await emaCross.getByLabel('Sol periyot').fill('20');
  await emaCross.getByLabel('Zaman dilimi').selectOption('1d');
  await emaCross.getByLabel('Operatör').selectOption('CROSSES_ABOVE');
  await emaCross.getByLabel('Sağ indikatör').selectOption('EMA:1');
  await emaCross.getByLabel('Sağ periyot').fill('50');
  await emaCross.getByLabel('Sağ zaman dilimi').selectOption('1d');

  const validationResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/scanner/validate'),
  );
  await page.getByRole('button', { name: 'Sunucuda doğrula' }).click();
  const validationResponse = await validationResponsePromise;
  expect(validationResponse.ok()).toBe(true);
  const validationEnvelope = (await validationResponse.json()) as {
    data: { valid: boolean; normalizedRule: unknown; errors: unknown[] };
  };
  expect(validationEnvelope.data.valid).toBe(true);
  expect(validationEnvelope.data.errors).toEqual([]);
  await expect(
    page.getByRole('heading', { name: 'Kural çalışmaya hazır.' }),
  ).toBeVisible();

  const runRequestPromise = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      new URL(request.url()).pathname.endsWith('/scanner/runs'),
  );
  const runResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/scanner/runs'),
  );
  const resultRequestPromise = page.waitForRequest(
    (request) =>
      request.method() === 'GET' &&
      new URL(request.url()).pathname.includes('/scanner/runs/') &&
      new URL(request.url()).pathname.endsWith('/results'),
  );
  await page.getByRole('button', { name: 'Taramayı çalıştır' }).click();

  const runRequest = await runRequestPromise;
  const requestPayload = runRequest.postDataJSON() as { rule: ScannerAst };
  const requestRule = requestPayload.rule;
  expect(requestRule.version).toBe(1);
  expect(requestRule.universe).toEqual({
    market: 'BIST',
    statuses: ['active'],
    indexCodes: [],
    sectorIds: [],
  });
  expect(requestRule.root.operator).toBe('AND');
  expect(requestRule.root.children).toHaveLength(2);

  const nodeIds = [
    requestRule.root.nodeId,
    ...requestRule.root.children.map(({ nodeId }) => nodeId),
  ];
  expect(new Set(nodeIds).size).toBe(3);
  expect(requestRule.root.nodeId).toMatch(/^group-[0-9a-f-]{36}$/i);
  for (const child of requestRule.root.children) {
    expect(child.nodeId).toMatch(/^condition-[0-9a-f-]{36}$/i);
  }

  const rsiCondition = requestRule.root.children.find(
    ({ left }) => left.code === 'RSI',
  );
  expect(rsiCondition).toMatchObject({
    operator: 'LT',
    left: {
      type: 'indicator',
      code: 'RSI',
      version: 1,
      timeframe: '1d',
      parameters: { period: 14 },
    },
    right: { type: 'constantNumber', value: 35 },
  });
  const crossCondition = requestRule.root.children.find(
    ({ operator }) => operator === 'CROSSES_ABOVE',
  );
  expect(crossCondition).toMatchObject({
    operator: 'CROSSES_ABOVE',
    left: {
      type: 'indicator',
      code: 'EMA',
      version: 1,
      timeframe: '1d',
      parameters: { period: 20 },
    },
    right: {
      type: 'indicator',
      code: 'EMA',
      version: 1,
      timeframe: '1d',
      parameters: { period: 50 },
    },
  });
  expect(canonicalSemantic(validationEnvelope.data.normalizedRule)).toEqual(
    canonicalSemantic(requestRule),
  );

  const runResponse = await runResponsePromise;
  expect(runResponse.status()).toBe(201);
  const runEnvelope = (await runResponse.json()) as {
    data: { id: string; ruleVersion: number; planVersion: number };
  };
  expect(runEnvelope.data.ruleVersion).toBe(1);
  expect(runEnvelope.data.planVersion).toBe(1);

  const resultRequest = await resultRequestPromise;
  const resultPath = new URL(resultRequest.url()).pathname;
  expect(resultPath).toContain(`/scanner/runs/${runEnvelope.data.id}/results`);
  await expect(
    page.getByRole('heading', { name: 'Tarama tamamlandı.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'E2E Round-trip Fixture' }),
  ).toBeVisible();
});

interface ScannerAst {
  version: number;
  universe: {
    market: string;
    statuses: string[];
    indexCodes: string[];
    sectorIds: string[];
  };
  root: {
    type: 'group';
    nodeId: string;
    operator: string;
    children: ScannerCondition[];
  };
}

interface ScannerCondition {
  type: 'condition';
  nodeId: string;
  operator: string;
  left: ScannerIndicator;
  right: ScannerIndicator | { type: 'constantNumber'; value: number };
}

interface ScannerIndicator {
  type: 'indicator';
  code: string;
  version: number;
  timeframe: string;
  parameters: Record<string, unknown>;
}

function canonicalSemantic(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(canonicalSemantic)
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      );
  }
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'nodeId')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalSemantic(item)]),
  );
}
