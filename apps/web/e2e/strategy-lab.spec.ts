import { createHash } from 'node:crypto';

import {
  expect,
  test,
  type Page,
  type Route,
  type TestInfo,
} from '@playwright/test';

test.describe.configure({ timeout: 60_000 });

interface LabIds {
  readonly namespace: string;
  readonly ownerUserId: string;
  readonly strategyId: string;
  readonly clonedStrategyId: string;
  readonly runId: string;
  readonly cancelRunId: string;
  readonly experimentId: string;
  readonly foreignId: string;
  readonly snapshotHash: string;
}

interface LabState {
  ids: LabIds;
  strategy: ReturnType<typeof strategy>;
  validationRequests: Record<string, unknown>[];
  backtestRequests: Record<string, unknown>[];
  runPolls: number;
  terminalPolls: number;
  tradePages: number;
  experimentRequests: Record<string, unknown>[];
  idempotencyKeys: Set<string>;
}

function state(testInfo: TestInfo): LabState {
  const ids = resourceIds(testInfo);
  return {
    ids,
    strategy: strategy(ids),
    validationRequests: [],
    backtestRequests: [],
    runPolls: 0,
    terminalPolls: 0,
    tradePages: 0,
    experimentRequests: [],
    idempotencyKeys: new Set(),
  };
}

test('strategy create, AST validation round-trip, revision, clone and keyboard', async ({
  page,
}, testInfo) => {
  const fixture = state(testInfo);
  const { clonedStrategyId, strategyId } = fixture.ids;
  await mockLabApi(page, fixture);
  await page.goto('/strategies/new');

  await expect(
    page.getByRole('heading', { name: 'Kuraldan araştırma protokolüne.' }),
  ).toBeVisible();
  await page.getByLabel('Entry indikatör 1').selectOption('RSI');
  await page.getByLabel('Entry periyot 1').fill('14');
  await page.getByLabel('Entry operatör 1').selectOption('LT');
  await page.getByLabel('Entry değer 1').fill('35');
  await page.getByRole('button', { name: '+ Koşul ekle' }).first().click();
  await page.getByLabel('Entry indikatör 2').selectOption('EMA');
  await page.getByLabel('Entry operatör 2').selectOption('CROSSES_ABOVE');
  await page.getByLabel('Entry değer 2').fill('50');
  await page.getByLabel('Exit operatör 1').selectOption('GT');
  await page.getByLabel('Exit değer 1').fill('60');

  await page.getByRole('button', { name: 'Sunucuda doğrula' }).click();
  await expect(
    page.getByRole('heading', { name: 'Çalıştırılabilir' }),
  ).toBeVisible();
  const definition = fixture.validationRequests.at(-1)!.definition as {
    entryRule: {
      root: { operator: string; children: Record<string, unknown>[] };
    };
    exitRule: { root: { children: Record<string, unknown>[] } };
    dataIntegrityPolicy: { universePolicy: string };
  };
  expect(definition.entryRule.root.operator).toBe('AND');
  expect(definition.entryRule.root.children).toHaveLength(2);
  expect(definition.entryRule.root.children[0]).toMatchObject({
    nodeId: 'condition-1',
    operator: 'LT',
    left: {
      code: 'RSI',
      version: 1,
      timeframe: '1d',
      parameters: { period: 14 },
    },
    right: { type: 'constantNumber', value: 35 },
  });
  expect(definition.entryRule.root.children[1]).toMatchObject({
    operator: 'CROSSES_ABOVE',
    left: { code: 'EMA', parameters: { period: 20 } },
    right: { code: 'EMA', parameters: { period: 50 } },
  });
  expect(definition.exitRule.root.children[0]).toMatchObject({
    operator: 'GT',
  });
  expect(definition.dataIntegrityPolicy.universePolicy).toBe('point_in_time');

  await page.getByRole('button', { name: 'Stratejiyi oluştur' }).click();
  await expect(page).toHaveURL(new RegExp(`/strategies/${strategyId}$`, 'u'));
  await page.getByLabel('Strateji adı').fill('RSI dönüş v2');
  await page.getByRole('button', { name: 'Yeni revision kaydet' }).click();
  await expect.poll(() => fixture.strategy.currentRevision).toBe(2);
  await page.getByRole('button', { name: 'Stratejiyi klonla' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/strategies/${clonedStrategyId}$`, 'u'),
  );

  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
  const unnamedButtons = await page
    .locator('button')
    .evaluateAll(
      (buttons) =>
        buttons.filter(
          (button) =>
            !button.textContent?.trim() && !button.getAttribute('aria-label'),
        ).length,
    );
  expect(unnamedButtons).toBe(0);
});

test('backtest payload round-trip, terminal polling, results, cursor and methodology', async ({
  page,
}, testInfo) => {
  const fixture = state(testInfo);
  const { runId, snapshotHash, strategyId } = fixture.ids;
  await mockLabApi(page, fixture);
  await page.goto(`/backtests?strategyId=${strategyId}`);
  await page.getByLabel('Backtest başlangıç').fill('2021-01-01');
  await page.getByLabel('Backtest bitiş').fill('2025-12-31');
  await page.getByLabel('Başlangıç sermayesi').fill('250000');
  await page.getByLabel('Adjustment mode').selectOption('splitAdjusted');
  await page.getByLabel('Parametre override').fill('32');
  const terminalResponsePromise = page.waitForResponse(async (response) => {
    if (
      response.request().method() !== 'GET' ||
      new URL(response.url()).pathname !== `/api/v1/backtests/${runId}`
    )
      return false;
    const body = (await response.json()) as { data?: { status?: string } };
    return body.data?.status === 'completed';
  });
  await page.getByRole('button', { name: 'Backtest çalıştır' }).click();
  const terminalResponse = await terminalResponsePromise;
  expect(terminalResponse.ok()).toBe(true);

  const payload = fixture.backtestRequests[0]!;
  expect(payload).toMatchObject({
    strategyId,
    strategyRevision: 1,
    rangeFrom: '2021-01-01T00:00:00.000Z',
    rangeTo: '2025-12-31T23:59:59.000Z',
    executionPlan: {
      initialCash: '250000',
      timeframe: '1d',
      executionPolicyVersion: 'next-open-v1',
      parameterBindings: { entryThreshold: 32 },
      corporateActionPolicy: { adjustmentMode: 'splitAdjusted' },
    },
  });
  await expect(page).toHaveURL(new RegExp(`/backtests/${runId}$`, 'u'));
  await expect(
    page.getByRole('heading', { name: 'Araştırma kaydı tamamlandı.' }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByRole('region', { name: 'Backtest özet metrikleri' }),
  ).toContainText('12.40');
  await expect(
    page.getByRole('img', { name: /Equity.*serisi/u }),
  ).toBeVisible();
  await expect(page.getByText(/Metinsel özet:/u).first()).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Metodoloji ve veri snapshot’ı' }),
  ).toBeVisible();
  await expect(page.getByText(snapshotHash, { exact: true })).toBeVisible();

  const secondTradePagePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === 'GET' &&
      url.pathname === `/api/v1/backtests/${runId}/trades` &&
      url.searchParams.get('cursor') === 'trade-page-2'
    );
  });
  await Promise.all([
    secondTradePagePromise,
    page.getByRole('button', { name: 'Daha fazla işlem' }).click(),
  ]);
  const rows = page.locator('.result-section tbody tr');
  await expect(rows).toHaveCount(4);
  expect(fixture.tradePages).toBe(2);
  const ids = await rows.locator('button').allTextContents();
  expect(ids).toHaveLength(4);
  await rows.first().getByRole('button', { name: 'Detay' }).click();
  await expect(
    page.getByRole('complementary', { name: 'İşlem detayı' }),
  ).toBeVisible();

  expect(fixture.runPolls).toBe(fixture.terminalPolls);
  expect(fixture.idempotencyKeys.size).toBe(1);
});

test('cancellation, grid experiment and in/out-of-sample comparison', async ({
  page,
}, testInfo) => {
  const fixture = state(testInfo);
  const { cancelRunId, experimentId, strategyId } = fixture.ids;
  await mockLabApi(page, fixture);
  await page.goto(`/backtests/${cancelRunId}`);
  await expect(
    page.getByRole('button', { name: 'Çalışmayı iptal et' }),
  ).toBeVisible();
  const cancellationResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/backtests/${cancelRunId}/cancel`,
  );
  const [cancellationResponse] = await Promise.all([
    cancellationResponsePromise,
    page.getByRole('button', { name: 'Çalışmayı iptal et' }).click(),
  ]);
  expect(cancellationResponse.ok()).toBe(true);
  const cancellationBody = (await cancellationResponse.json()) as {
    data?: { status?: string };
  };
  expect(cancellationBody.data?.status).toBe('cancelled');
  await expect(page.getByText(/Run cancelled/u)).toBeVisible();

  await page.goto('/experiments');
  await page.getByLabel('Grid değerleri').fill('25, 35, 45');
  await expect(page.getByText('6').first()).toBeVisible();
  const experimentResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/experiments',
  );
  const [experimentResponse] = await Promise.all([
    experimentResponsePromise,
    page.getByRole('button', { name: 'Deneyi başlat' }).click(),
  ]);
  expect(experimentResponse.ok()).toBe(true);
  expect(fixture.experimentRequests[0]).toMatchObject({
    strategyId,
    definition: {
      grid: {
        axes: [{ parameter: 'entryThreshold', values: [25, 35, 45] }],
        samples: [{ role: 'inSample' }, { role: 'outOfSample' }],
      },
    },
  });
  await expect(page).toHaveURL(
    new RegExp(`/experiments/${experimentId}$`, 'u'),
  );
  await expect(
    page.getByRole('heading', { name: 'Parametre dayanıklılığı' }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'inSample' }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'outOfSample' }).first(),
  ).toBeVisible();
  await expect(page.getByText(/Out-of-sample bozulma/u)).toBeVisible();
});

test('strategy, run and experiment IDOR are rendered safely', async ({
  page,
}, testInfo) => {
  const fixture = state(testInfo);
  const { foreignId } = fixture.ids;
  await mockLabApi(page, fixture);
  for (const path of [
    `/strategies/${foreignId}`,
    `/backtests/${foreignId}`,
    `/experiments/${foreignId}`,
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole('alert').filter({ hasText: 'erişim izniniz yok' }),
    ).toBeVisible();
    await expect(page.getByText(/stack|postgres|providerRaw/iu)).toHaveCount(0);
  }
});

async function mockLabApi(page: Page, fixture: LabState) {
  const {
    cancelRunId,
    clonedStrategyId,
    experimentId,
    foreignId,
    runId,
    strategyId,
  } = fixture.ids;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    const method = request.method();
    if (path === '/notifications/unread-count')
      return envelope(route, { unreadCount: 0 });
    if (path.includes(foreignId)) {
      const code = path.startsWith('/strategies')
        ? 'STRATEGY_ACCESS_DENIED'
        : path.startsWith('/backtests')
          ? 'BACKTEST_RUN_ACCESS_DENIED'
          : 'EXPERIMENT_ACCESS_DENIED';
      return apiError(route, code, 403);
    }
    if (path === '/strategies' && method === 'GET')
      return envelope(route, { items: [fixture.strategy] });
    if (path === '/strategies/validate' && method === 'POST') {
      const input = request.postDataJSON() as {
        definition: Record<string, unknown>;
      };
      fixture.validationRequests.push(input);
      return envelope(route, validation(input.definition));
    }
    if (path === '/strategies' && method === 'POST') {
      const input = request.postDataJSON() as {
        name: string;
        description: string;
        definition: Record<string, unknown>;
      };
      fixture.strategy = strategy(
        fixture.ids,
        strategyId,
        input.name,
        input.definition,
      );
      return envelope(route, fixture.strategy, 201);
    }
    if (path === `/strategies/${strategyId}` && method === 'GET')
      return envelope(route, fixture.strategy);
    if (path === `/strategies/${strategyId}` && method === 'PATCH') {
      const input = request.postDataJSON() as {
        name: string;
        definition: Record<string, unknown>;
      };
      fixture.strategy = {
        ...fixture.strategy,
        name: input.name,
        currentRevision: 2,
        revision: {
          ...fixture.strategy.revision,
          revision: 2,
          definition: input.definition,
        },
      };
      return envelope(route, fixture.strategy);
    }
    if (path === `/strategies/${strategyId}/revisions`)
      return envelope(route, { items: [fixture.strategy.revision] });
    if (path === `/strategies/${strategyId}/clone` && method === 'POST')
      return envelope(
        route,
        strategy(
          fixture.ids,
          clonedStrategyId,
          `${fixture.strategy.name} (Kopya)`,
        ),
        201,
      );
    if (path === `/strategies/${clonedStrategyId}`)
      return envelope(
        route,
        strategy(
          fixture.ids,
          clonedStrategyId,
          `${fixture.strategy.name} (Kopya)`,
        ),
      );

    if (path === '/backtests' && method === 'GET')
      return envelope(route, { items: [] });
    if (path === '/backtests' && method === 'POST') {
      const idempotencyKey = request.headers()['idempotency-key'];
      expect(idempotencyKey).toBeTruthy();
      expect(fixture.idempotencyKeys.has(idempotencyKey!)).toBe(false);
      fixture.idempotencyKeys.add(idempotencyKey!);
      fixture.backtestRequests.push(
        request.postDataJSON() as Record<string, unknown>,
      );
      return envelope(route, run(fixture.ids, runId, 'queued', 2), 201);
    }
    if (path === `/backtests/${cancelRunId}` && method === 'GET')
      return envelope(route, run(fixture.ids, cancelRunId, 'running', 44));
    if (path === `/backtests/${cancelRunId}/cancel` && method === 'POST')
      return envelope(route, run(fixture.ids, cancelRunId, 'cancelled', 44));
    if (path === `/backtests/${runId}` && method === 'GET') {
      fixture.runPolls += 1;
      const result =
        fixture.runPolls < 2
          ? run(fixture.ids, runId, 'running', 65)
          : run(fixture.ids, runId, 'completed', 100);
      if (result.status === 'completed')
        fixture.terminalPolls = fixture.runPolls;
      return envelope(route, result);
    }
    if (path === `/backtests/${runId}/summary`)
      return envelope(route, summary(fixture.ids));
    if (path === `/backtests/${runId}/methodology`)
      return envelope(route, methodology(fixture.ids));
    if (path === `/backtests/${runId}/orders`)
      return envelope(route, { items: [{ id: 'order-1', status: 'filled' }] });
    if (path === `/backtests/${runId}/fills`)
      return envelope(route, { items: [{ id: 'fill-1', price: '101.2' }] });
    if (path === `/backtests/${runId}/series`)
      return envelope(route, {
        items: series(url.searchParams.get('type') ?? 'equity'),
      });
    if (path === `/backtests/${runId}/trades`) {
      fixture.tradePages += 1;
      const second = url.searchParams.has('cursor');
      return envelope(
        route,
        { items: trades(second ? 2 : 0) },
        { nextCursor: second ? null : 'trade-page-2' },
      );
    }

    if (path === '/experiments' && method === 'GET')
      return envelope(route, { items: [] });
    if (path === '/experiments' && method === 'POST') {
      fixture.experimentRequests.push(
        request.postDataJSON() as Record<string, unknown>,
      );
      return envelope(route, experiment(fixture.ids), 201);
    }
    if (path === `/experiments/${experimentId}`)
      return envelope(route, experiment(fixture.ids));
    if (path === `/experiments/${experimentId}/results`)
      return envelope(route, {
        items: matrix().map((item, index) => ({
          ...item,
          runId: `run-${index}`,
        })),
      });
    if (path === `/experiments/${experimentId}/matrix`)
      return envelope(route, { items: matrix() });
    if (path === `/experiments/${experimentId}/export`)
      return route.fulfill({
        status: 200,
        contentType: 'text/csv',
        body: 'bindingHash,return\nsafe,12.4',
      });
    throw new Error(`Unhandled strategy lab API: ${method} ${path}`);
  });
}

async function envelope(
  route: Route,
  data: unknown,
  statusOrMeta: number | Record<string, unknown> = 200,
  maybeMeta: Record<string, unknown> = {},
) {
  const status = typeof statusOrMeta === 'number' ? statusOrMeta : 200;
  const meta = typeof statusOrMeta === 'number' ? maybeMeta : statusOrMeta;
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({
      data,
      meta: { requestId: 'strategy-lab-e2e', ...meta },
    }),
  });
}
async function apiError(route: Route, code: string, status: number) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code, message: code } }),
  });
}

function resourceIds(testInfo: TestInfo): LabIds {
  const namespace = createHash('sha256')
    .update(
      `${testInfo.testId}:${testInfo.project.name}:${testInfo.repeatEachIndex}:${testInfo.workerIndex}`,
    )
    .digest('hex')
    .slice(0, 12);
  const id = (role: string) => {
    const hex = createHash('sha256')
      .update(`${namespace}:${role}`)
      .digest('hex')
      .slice(0, 32);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
  };
  return {
    namespace,
    ownerUserId: id('owner'),
    strategyId: id('strategy'),
    clonedStrategyId: id('clone'),
    runId: id('run'),
    cancelRunId: id('cancel-run'),
    experimentId: id('experiment'),
    foreignId: id('foreign'),
    snapshotHash: `snapshot-pit-${namespace}`,
  };
}

function strategy(
  ids: LabIds,
  id = ids.strategyId,
  name = 'RSI dönüş stratejisi',
  definition: Record<string, unknown> = definitionFixture(),
) {
  return {
    id,
    ownerUserId: ids.ownerUserId,
    name,
    description: 'Point-in-time BIST araştırması',
    status: 'validated' as const,
    currentRevision: 1,
    updatedAt: '2026-07-18T12:00:00.000Z',
    revision: {
      revision: 1,
      definition,
      status: 'validated' as const,
      validation: validation(definition),
    },
  };
}
function validation(definition: Record<string, unknown>) {
  return {
    valid: true,
    errors: [],
    warnings: [],
    normalizedDefinition: definition,
    complexityScore: 42,
    workload: {
      nodeCount: 4,
      conditionCount: 3,
      indicatorCount: 3,
      timeframeCount: 1,
      estimatedOperationsPerInstrument: 420,
    },
    warmup: { maximumBars: 51 },
    requiredData: {
      requiresHistoricalUniverse: true,
      requiresCorporateActions: true,
      fundamentalMetrics: [],
    },
  };
}
function definitionFixture() {
  return {
    schemaVersion: 1,
    baseTimeframe: '1d',
    entryRule: {
      version: 1,
      universe: {
        market: 'BIST',
        statuses: ['active'],
        indexCodes: ['XU100'],
        sectorIds: [],
      },
      root: {
        type: 'group',
        nodeId: 'root-and',
        operator: 'AND',
        children: [],
      },
    },
    exitRule: {
      version: 1,
      universe: {
        market: 'BIST',
        statuses: ['active'],
        indexCodes: ['XU100'],
        sectorIds: [],
      },
      root: {
        type: 'group',
        nodeId: 'root-and',
        operator: 'AND',
        children: [],
      },
    },
    filterRule: null,
    parameters: [],
    positionSizing: { type: 'equalWeight' },
    riskControls: {
      maxPositionWeight: 20,
      maxConcurrentPositions: 5,
      allowShort: false,
      allowLeverage: false,
      allowNegativeCash: false,
    },
    executionPolicy: { code: 'closed_bar_next_open' },
    costPolicy: { code: 'percentage_commission_fixed_bps_slippage' },
    dataIntegrityPolicy: {
      universePolicy: 'point_in_time',
      adjustmentMode: 'split_adjusted',
    },
    benchmarkCode: 'XU100',
  };
}
function run(
  ids: LabIds,
  id: string,
  status: 'queued' | 'running' | 'completed' | 'cancelled',
  progressPercent: number,
) {
  return {
    id,
    strategyId: ids.strategyId,
    strategyRevision: 1,
    status,
    progressPercent,
    queuedAt: '2026-07-18T12:00:00.000Z',
    completedAt: status === 'completed' ? '2026-07-18T12:03:00.000Z' : null,
    errorCode: null,
    dataSnapshotHash: ids.snapshotHash,
  };
}
function summary(ids: LabIds) {
  return {
    endingEquity: '112400',
    totalReturn: '12.40',
    annualizedReturn: '5.80',
    maximumDrawdown: '-8.20',
    sharpe: '1.12',
    sortino: '1.34',
    calmar: '0.71',
    tradeCount: 48,
    winRate: '54.20',
    profitFactor: '1.38',
    exposure: '68.2',
    turnover: '3.1',
    totalFees: '842.20',
    totalSlippage: '310.10',
    benchmarkReturn: '9.10',
    dataSnapshot: {
      id: 'snapshot-id',
      hash: ids.snapshotHash,
      dataCutoffAt: '2026-07-18T15:00:00.000Z',
      coverageStatus: 'partial',
    },
    warnings: [{ code: 'PARTIAL_POINT_IN_TIME_COVERAGE' }],
  };
}
function methodology(ids: LabIds) {
  return {
    engineVersion: 'backtest-engine-v1',
    executionPolicyVersion: 'next-open-v1',
    costPolicyVersion: 'cost-v1',
    eventOrderingPolicyVersion: 'deterministic-ordering-v1',
    dataSnapshot: { hash: ids.snapshotHash },
  };
}
function series(type: string) {
  return Array.from({ length: 8 }, (_, index) => ({
    timestamp: `2025-01-${String(index + 1).padStart(2, '0')}T15:00:00.000Z`,
    value: String(
      type === 'drawdown'
        ? -index
        : type === 'exposure'
          ? 50 + index
          : 100000 + index * 1000,
    ),
  }));
}
function trades(offset: number) {
  return Array.from({ length: 2 }, (_, index) => ({
    id: `trade-${offset + index}`,
    instrumentId: `instrument-${offset + index}`,
    symbol: ['THYAO', 'ASELS', 'TUPRS', 'BIMAS'][offset + index],
    openedAt: '2025-01-02',
    closedAt: '2025-01-10',
    entryPrice: '100',
    exitPrice: '110',
    quantity: '10',
    realizedPnl: offset + index === 1 ? '-20' : '100',
    returnPercent: '10',
    fees: '2',
  }));
}
function experiment(ids: LabIds) {
  return {
    id: ids.experimentId,
    name: 'Threshold grid',
    strategyId: ids.strategyId,
    strategyRevision: 1,
    status: 'completed',
    combinationCount: 6,
    completedRunCount: 6,
    failedRunCount: 0,
    warnings: [{ code: 'OVERFITTING_RISK' }],
    createdAt: '2026-07-18T12:00:00.000Z',
  };
}
function matrix() {
  return [
    {
      bindingHash: 'b25-in',
      sampleRole: 'inSample',
      parameterBinding: { entryThreshold: 25 },
      selectedMetrics: { totalReturn: 18, maximumDrawdown: -12, sharpe: 1.4 },
      rank: 1,
    },
    {
      bindingHash: 'b25-out',
      sampleRole: 'outOfSample',
      parameterBinding: { entryThreshold: 25 },
      selectedMetrics: { totalReturn: 7, maximumDrawdown: -9, sharpe: 0.8 },
      rank: 4,
    },
    {
      bindingHash: 'b35-in',
      sampleRole: 'inSample',
      parameterBinding: { entryThreshold: 35 },
      selectedMetrics: { totalReturn: 14, maximumDrawdown: -8, sharpe: 1.2 },
      rank: 2,
    },
  ];
}
