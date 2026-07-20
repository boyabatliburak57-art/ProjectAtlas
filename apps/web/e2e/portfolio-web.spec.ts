import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
} from '@playwright/test';

test.describe.configure({ mode: 'serial', timeout: 60_000 });

const portfolioId = '10000000-0000-4000-8000-000000000049';
const partialPortfolioId = '20000000-0000-4000-8000-000000000049';
const foreignPortfolioId = '30000000-0000-4000-8000-000000000049';
const instrumentId = '40000000-0000-4000-8000-000000000049';

interface LedgerTransaction {
  id: string;
  type: string;
  status: 'draft' | 'posted' | 'reversed';
  instrumentId: string | null;
  quantity: string | null;
  unitPrice: string | null;
  cashAmount: string | null;
  fee: string;
  tax: string;
  note: string | null;
  tradeAt: string;
}

interface PortfolioFixture {
  portfolios: Record<string, unknown>[];
  transactions: LedgerTransaction[];
  importJob: Record<string, unknown> | null;
  importRows: Record<string, unknown>[];
  importSequence: number;
  sequence: number;
}

function fixture(): PortfolioFixture {
  return {
    portfolios: [
      portfolio(portfolioId, 'Uzun Vade'),
      portfolio(partialPortfolioId, 'Eksik Fiyat Portföyü'),
    ],
    transactions: [],
    importJob: null,
    importRows: [],
    importSequence: 0,
    sequence: 0,
  };
}

function portfolio(id: string, name: string) {
  return {
    id,
    userId: '90000000-0000-4000-8000-000000000049',
    name,
    description: 'BIST payları ve nakit',
    reportingCurrency: 'TRY',
    defaultBenchmarkCode: 'XU100',
    status: 'active',
    ledgerVersion: 0,
    createdAt: '2026-07-01T09:00:00.000Z',
    updatedAt: '2026-07-16T09:00:00.000Z',
    deletedAt: null,
  };
}

async function envelope(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ data, meta: { requestId: 'portfolio-web-e2e' } }),
  });
}

async function apiError(route: Route, code: string, status: number) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code, message: code } }),
  });
}

async function mockPortfolioApi(page: Page, state: PortfolioFixture) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    const method = request.method();
    if (path === '/notifications/unread-count')
      return envelope(route, { unreadCount: 0 });
    if (path === '/portfolios' && method === 'GET')
      return envelope(route, { items: state.portfolios });
    if (path === '/portfolios' && method === 'POST') {
      const input = request.postDataJSON() as {
        name: string;
        description?: string;
      };
      const created = portfolio(
        '50000000-0000-4000-8000-000000000049',
        input.name,
      );
      state.portfolios.unshift({
        ...created,
        description: input.description ?? null,
      });
      return envelope(route, created, 201);
    }
    if (path === `/portfolios/${foreignPortfolioId}`)
      return apiError(route, 'PORTFOLIO_ACCESS_DENIED', 403);
    const owned = state.portfolios.find(
      (item) => item.id === path.split('/')[2],
    );
    if (/^\/portfolios\/[^/]+$/u.test(path) && method === 'GET')
      return owned
        ? envelope(route, owned)
        : apiError(route, 'PORTFOLIO_NOT_FOUND', 404);
    if (/^\/portfolios\/[^/]+$/u.test(path) && method === 'DELETE') {
      Object.assign(owned!, {
        status: 'deleted',
        deletedAt: '2026-07-16T12:00:00.000Z',
      });
      return envelope(route, owned);
    }
    if (path.endsWith('/restore') && method === 'POST') {
      Object.assign(owned!, { status: 'active', deletedAt: null });
      return envelope(route, owned);
    }
    if (path === `/portfolios/${portfolioId}/transactions` && method === 'GET')
      return envelope(route, {
        items: [...state.transactions].reverse().map(transactionDto),
      });
    if (
      path === `/portfolios/${portfolioId}/transactions` &&
      method === 'POST'
    ) {
      const input = request.postDataJSON() as Record<string, string | null>;
      state.sequence += 1;
      const transaction: LedgerTransaction = {
        id: `60000000-0000-4000-8000-${String(state.sequence).padStart(12, '0')}`,
        type: String(input.type),
        status: 'draft',
        instrumentId: input.instrumentId ?? null,
        quantity: input.quantity ?? null,
        unitPrice: input.unitPrice ?? null,
        cashAmount: input.cashAmount ?? null,
        fee: input.fee ?? '0',
        tax: input.tax ?? '0',
        note: input.note ?? null,
        tradeAt: String(input.tradeAt),
      };
      state.transactions.push(transaction);
      return envelope(route, transactionDto(transaction), 201);
    }
    const postMatch = path.match(
      new RegExp(`^/portfolios/${portfolioId}/transactions/([^/]+)/post$`, 'u'),
    );
    if (postMatch && method === 'POST') {
      const transaction = state.transactions.find(
        (item) => item.id === postMatch[1],
      )!;
      transaction.status = 'posted';
      return envelope(route, transactionDto(transaction));
    }
    const reverseMatch = path.match(
      new RegExp(
        `^/portfolios/${portfolioId}/transactions/([^/]+)/reverse$`,
        'u',
      ),
    );
    if (reverseMatch && method === 'POST') {
      const transaction = state.transactions.find(
        (item) => item.id === reverseMatch[1],
      )!;
      transaction.status = 'reversed';
      return envelope(route, transactionDto(transaction));
    }
    if (path.endsWith('/positions') && method === 'GET')
      return envelope(route, { items: projection(state) });
    if (path.endsWith('/valuation') && method === 'GET') {
      const id = path.split('/')[2]!;
      return envelope(route, valuation(state, id === partialPortfolioId));
    }
    if (path.endsWith('/performance') && method === 'GET')
      return envelope(route, performance());
    if (path.endsWith('/risk') && method === 'GET')
      return envelope(route, risk());
    if (path.endsWith('/recalculate') && method === 'POST')
      return envelope(route, {
        portfolioId,
        ledgerVersion: state.sequence,
        status: 'completed',
      });
    if (path === `/portfolios/${portfolioId}/imports` && method === 'POST') {
      state.importSequence += 1;
      const upload = request.postDataBuffer()?.toString('utf8') ?? '';
      const formula = upload.includes('=cmd');
      const invalid = formula || upload.includes('not-a-date');
      state.importRows = [
        {
          rowNumber: 2,
          status: invalid ? 'invalid' : 'valid',
          duplicateOfTransactionId: null,
          rawData: {
            transactionType: 'cashDeposit',
            symbol: '',
            tradeDate: invalid && !formula ? 'not-a-date' : '2026-07-16',
            note: formula ? '=cmd' : 'Açılış nakdi',
          },
          validationErrors: invalid
            ? [
                {
                  code: formula ? 'CSV_FORMULA_INJECTION' : 'CSV_DATE_INVALID',
                  field: formula ? 'note' : 'tradeDate',
                  message: 'invalid',
                },
              ]
            : [],
        },
      ];
      state.importJob = {
        id: `70000000-0000-4000-8000-${String(state.importSequence).padStart(12, '0')}`,
        portfolioId,
        status: 'preview_ready',
        commitMode: 'atomic',
        sourceFilename: formula
          ? 'formula.csv'
          : invalid
            ? 'invalid.csv'
            : 'valid.csv',
        fileSize: upload.length,
        encoding: 'utf-8',
        delimiter: ',',
        totalRowCount: 1,
        validRowCount: invalid ? 0 : 1,
        invalidRowCount: invalid ? 1 : 0,
        duplicateRowCount: 0,
        committedRowCount: 0,
        errorSummary: invalid
          ? { [formula ? 'CSV_FORMULA_INJECTION' : 'CSV_DATE_INVALID']: 1 }
          : {},
        previewExpiresAt: '2026-07-16T13:00:00.000Z',
        committedAt: null,
        errorCode: null,
      };
      return envelope(route, state.importJob, 201);
    }
    if (path.endsWith('/rows') && method === 'GET')
      return envelope(route, { items: state.importRows });
    if (path.endsWith('/commit') && method === 'POST') {
      const mode = (request.postDataJSON() as { mode: string }).mode;
      state.importJob = {
        ...state.importJob!,
        status: 'completed',
        commitMode: mode,
        committedRowCount: state.importRows.filter(
          (row) => row.status === 'valid',
        ).length,
        committedAt: '2026-07-16T12:30:00.000Z',
      };
      return envelope(route, state.importJob);
    }
    return route.fulfill({ status: 404, body: '{}' });
  });
}

test('portfolio create, ledger, weighted average, partial sell and reversal', async ({
  page,
}) => {
  const state = fixture();
  await mockPortfolioApi(page, state);
  await page.goto('/portfolios');
  await page.getByRole('button', { name: 'Yeni portföy' }).click();
  await page.getByLabel('Portföy adı').fill('Temettü Portföyü');
  await page.getByLabel('Açıklama').fill('Uzun vadeli birikim');
  await page.getByRole('button', { name: 'Portföy oluştur' }).click();
  await expect(page.getByText('Temettü Portföyü')).toBeVisible();

  await page.goto(`/portfolios/${portfolioId}/transactions`);
  await page.getByLabel('Nakit tutarı').fill('5000');
  await page.getByLabel('Not').fill('Açılış nakdi');
  await page.getByRole('button', { name: 'Taslak oluştur' }).click();
  await expect(page.getByText('Taslak').last()).toBeVisible();
  await postTransaction(
    page,
    page.getByRole('row').filter({ hasText: 'Açılış nakdi' }),
  );
  await expect(page.getByText('Posted').last()).toBeVisible();

  await createAndPostBuy(page, '10', '100', 'İlk alış');
  await page.getByRole('link', { name: 'Özet' }).click();
  await expect(page.getByRole('heading', { name: 'Pozisyonlar' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByRole('cell', { name: '10', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: '100,00 ₺' })).toBeVisible();

  await page.getByRole('link', { name: 'İşlemler' }).click();
  await createAndPostBuy(page, '10', '200', 'İkinci alış');
  await page.getByRole('link', { name: 'Özet' }).click();
  await expect(page.getByRole('heading', { name: 'Pozisyonlar' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('cell', { name: '150,00 ₺' })).toBeVisible();

  await page.getByRole('link', { name: 'İşlemler' }).click();
  await page.getByLabel('İşlem türü').selectOption('sell');
  await page.getByLabel('Enstrüman kimliği').fill(instrumentId);
  await page.getByLabel('Miktar').fill('5');
  await page.getByLabel('Birim fiyat').fill('180');
  await page.getByLabel('Not').fill('Kısmi satış');
  await page.getByRole('button', { name: 'Taslak oluştur' }).click();
  const sellDraftRow = page.getByRole('row').filter({ hasText: 'Kısmi satış' });
  await postTransaction(page, sellDraftRow);
  await expect(sellDraftRow.getByText('Posted')).toBeVisible();
  await page.getByRole('link', { name: 'Özet' }).click();
  await expect(page.getByRole('heading', { name: 'Pozisyonlar' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByRole('cell', { name: '15', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('150,00 ₺').first()).toBeVisible();
  await expect(
    page.getByRole('cell', { name: '+300,00 ₺', exact: true }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'İşlemler' }).click();
  const sellRow = page.getByRole('row').filter({ hasText: 'Kısmi satış' });
  const reversalResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/reverse'),
  );
  await Promise.all([
    reversalResponsePromise,
    sellRow.getByRole('button', { name: 'Ters kayıt oluştur' }).click(),
  ]);
  await expect(sellRow.getByText('Reversal tamamlandı')).toBeVisible();
});

test('performance, risk, partial valuation, accessibility and IDOR', async ({
  page,
}) => {
  const state = fixture();
  await mockPortfolioApi(page, state);
  await page.goto(`/portfolios/${portfolioId}/performance`);
  await expect(
    page.getByRole('heading', { name: 'Portföy değeri' }),
  ).toBeVisible();
  await expect(
    page.getByRole('img', { name: /Portföy değeri grafiği/ }),
  ).toBeVisible();
  await expect(page.getByText('twr-xirr-v1')).toBeVisible();
  await page.getByRole('link', { name: 'Risk' }).click();
  await expect(page.getByRole('heading', { name: 'Volatilite' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText('historical-risk-v1').first()).toBeVisible();
  await expect(page.getByRole('note')).toContainText(
    'yatırım tavsiyesi değildir',
  );

  await page.goto(`/portfolios/${partialPortfolioId}`);
  await expect(page.getByText('Kısmi değerleme')).toBeVisible();
  await expect(
    page.getByText(/Eksik fiyatlar sıfır kabul edilmedi/),
  ).toBeVisible();

  await page.goto(`/portfolios/${foreignPortfolioId}`);
  await expect(
    page.getByText('Bu portföye erişim yetkiniz yok.'),
  ).toBeVisible();

  await page.goto('/portfolios');
  await page.keyboard.press('Tab');
  const focused = page.locator(':focus');
  await expect(focused).toBeVisible();
  expect(
    await focused.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe('none');
  await expect(
    page.getByRole('navigation', { name: 'Ürün navigasyonu' }),
  ).toBeVisible();
});

test('CSV preview, commit, invalid row, formula injection and error report', async ({
  page,
}) => {
  const state = fixture();
  await mockPortfolioApi(page, state);
  await page.goto(`/portfolios/${portfolioId}/import`);
  await page.getByLabel('CSV dosyası seçin').setInputFiles({
    name: 'valid.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'portfolio,transactionType,symbol,tradeDate,quantity,unitPrice,fee,tax,cashAmount,externalReference,note\nUzun Vade,cashDeposit,,2026-07-16,,,,,1000,ref,Açılış',
    ),
  });
  await page.getByRole('button', { name: 'CSV önizle' }).click();
  await expect(
    page.getByRole('heading', { name: 'Önizleme sonucu' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Atomic commit' }).click();
  await expect(page.getByText('İçe aktarma tamamlandı')).toBeVisible();

  await page.getByLabel('CSV dosyası seçin').setInputFiles({
    name: 'invalid.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'portfolio,transactionType,symbol,tradeDate,quantity,unitPrice,fee,tax,cashAmount,externalReference,note\nUzun Vade,cashDeposit,,not-a-date,,,,,1000,ref,Hatalı',
    ),
  });
  await page.getByRole('button', { name: 'CSV önizle' }).click();
  await expect(page.getByText('CSV_DATE_INVALID')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Atomic commit' }),
  ).toBeDisabled();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Hata raporunu indir' }).click();
  expect((await download).suggestedFilename()).toBe('invalid-errors.csv');

  await page.getByLabel('CSV dosyası seçin').setInputFiles({
    name: 'formula.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'portfolio,transactionType,symbol,tradeDate,quantity,unitPrice,fee,tax,cashAmount,externalReference,note\nUzun Vade,cashDeposit,,2026-07-16,,,,,1000,ref,=cmd',
    ),
  });
  await page.getByRole('button', { name: 'CSV önizle' }).click();
  await expect(page.getByText('CSV_FORMULA_INJECTION')).toBeVisible();
  await page.getByLabel(/Partial/).check();
  await expect(
    page.getByRole('button', { name: 'Partial commit' }),
  ).toBeEnabled();
});

async function createAndPostBuy(
  page: Page,
  quantity: string,
  price: string,
  note: string,
) {
  await page.getByLabel('İşlem türü').selectOption('buy');
  await page.getByLabel('Enstrüman kimliği').fill(instrumentId);
  await page.getByLabel('Miktar').fill(quantity);
  await page.getByLabel('Birim fiyat').fill(price);
  await page.getByLabel('Not').fill(note);
  await page.getByRole('button', { name: 'Taslak oluştur' }).click();
  const draftRow = page.getByRole('row').filter({ hasText: note });
  await postTransaction(page, draftRow);
  await expect(draftRow.getByText('Posted')).toBeVisible();
}

async function postTransaction(page: Page, row: Locator) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/post'),
  );
  const [response] = await Promise.all([
    responsePromise,
    row.getByRole('button', { name: 'Post et' }).click(),
  ]);
  expect(response.ok()).toBe(true);
}

function transactionDto(transaction: LedgerTransaction) {
  return {
    ...transaction,
    portfolioId,
    reversalOfTransactionId: null,
    sequence: Number(transaction.id.slice(-12)),
    settlementAt: null,
    source: 'manual',
    externalReference: null,
    adjustmentReason: null,
    postedAt:
      transaction.status === 'posted' ? '2026-07-16T10:00:00.000Z' : null,
    reversedAt:
      transaction.status === 'reversed' ? '2026-07-16T11:00:00.000Z' : null,
    createdAt: transaction.tradeAt,
    updatedAt: transaction.tradeAt,
  };
}

function ledger(state: PortfolioFixture) {
  let quantity = 0;
  let averageCost = 0;
  let realized = 0;
  let cash = 0;
  for (const item of state.transactions.filter(
    (transaction) => transaction.status === 'posted',
  )) {
    if (item.type === 'cashDeposit') cash += Number(item.cashAmount);
    if (item.type === 'buy') {
      const bought = Number(item.quantity);
      const cost = bought * Number(item.unitPrice) + Number(item.fee);
      averageCost = (quantity * averageCost + cost) / (quantity + bought);
      quantity += bought;
      cash -= cost + Number(item.tax);
    }
    if (item.type === 'sell') {
      const sold = Number(item.quantity);
      const proceeds =
        sold * Number(item.unitPrice) - Number(item.fee) - Number(item.tax);
      realized += proceeds - sold * averageCost;
      quantity -= sold;
      cash += proceeds;
    }
  }
  return { quantity, averageCost, realized, cash };
}

function projection(state: PortfolioFixture) {
  const value = ledger(state);
  return value.quantity > 0
    ? [
        {
          portfolioId,
          instrumentId,
          symbol: 'THYAO',
          company: 'Türk Hava Yolları',
          sector: 'Ulaştırma',
          quantity: String(value.quantity),
          averageCost: String(value.averageCost),
          costBasis: String(value.quantity * value.averageCost),
          realizedPnl: String(value.realized),
          dividendIncome: '0',
          ledgerVersion: state.sequence,
          calculatedAt: '2026-07-16T12:00:00.000Z',
        },
      ]
    : [];
}

function valuation(state: PortfolioFixture, partial: boolean) {
  const current = ledger(state);
  const price = 170;
  const missing = partial ? 1 : 0;
  return {
    portfolioId: partial ? partialPortfolioId : portfolioId,
    ledgerVersion: state.sequence,
    valuationAt: '2026-07-16T12:00:00.000Z',
    dataCutoffAt: '2026-07-16T11:00:00.000Z',
    pricePolicyVersion: 'closed-daily-v1',
    mode: 'official',
    persistable: true,
    status: partial ? 'partial' : 'complete',
    cashBalance: String(current.cash),
    positionsMarketValue: partial ? '0' : String(current.quantity * price),
    totalValue: String(current.cash + (partial ? 0 : current.quantity * price)),
    realizedPnl: String(current.realized),
    unrealizedPnl: partial
      ? null
      : String(current.quantity * (price - current.averageCost)),
    netContributions: '5000',
    missingPriceCount: missing,
    warnings: partial ? [{ code: 'MISSING_PRICE', instrumentId }] : [],
    positions:
      current.quantity > 0
        ? [
            {
              instrumentId,
              status: partial ? 'missing_price' : 'valued',
              quantity: String(current.quantity),
              averageCost: String(current.averageCost),
              costBasis: String(current.quantity * current.averageCost),
              marketPrice: partial ? null : String(price),
              marketValue: partial ? null : String(current.quantity * price),
              unrealizedPnl: partial
                ? null
                : String(current.quantity * (price - current.averageCost)),
              dailyChangePercent: '0.012',
              priceAt: partial ? null : '2026-07-16T11:00:00.000Z',
              warningCode: partial ? 'MISSING_PRICE' : null,
            },
          ]
        : [],
  };
}

function performance() {
  return {
    portfolioId,
    ledgerVersion: 4,
    rangeStartAt: '2026-07-14T00:00:00.000Z',
    rangeEndAt: '2026-07-16T00:00:00.000Z',
    dataCutoffAt: '2026-07-16T11:00:00.000Z',
    performancePolicyVersion: 'twr-xirr-v1',
    benchmarkCode: 'XU100',
    status: 'complete',
    dailyValueSeries: [
      { date: '2026-07-14', value: '5000', externalFlow: '5000' },
      { date: '2026-07-15', value: '5100', externalFlow: '0' },
      { date: '2026-07-16', value: '5400', externalFlow: '0' },
    ],
    netContributionSeries: [
      { date: '2026-07-14', value: '5000' },
      { date: '2026-07-16', value: '5000' },
    ],
    twr: { status: 'complete', value: '0.08' },
    xirr: { status: 'complete', value: '0.12' },
    benchmark: {
      status: 'complete',
      priceReturn: '0.05',
      totalReturn: '0.052',
      alignedDates: ['2026-07-14', '2026-07-15', '2026-07-16'],
      warnings: [],
    },
    periodReturns: {},
    warnings: [],
  };
}

function risk() {
  const metric = (value: string) => ({
    value,
    status: 'complete',
    reasonCode: null,
    observationCount: 252,
    methodologyVersion: 'historical-risk-v1',
    warnings: [],
  });
  return {
    portfolioId,
    ledgerVersion: 4,
    rangeStartAt: '2025-07-16T00:00:00.000Z',
    rangeEndAt: '2026-07-16T00:00:00.000Z',
    dataCutoffAt: '2026-07-16T11:00:00.000Z',
    benchmarkCode: 'XU100',
    riskPolicyVersion: 'historical-risk-v1',
    status: 'complete',
    observationCount: 252,
    volatility: metric('0.24'),
    beta: metric('1.08'),
    correlation: metric('0.72'),
    drawdown: {
      ...metric('0'),
      value: {
        maximumDrawdown: '-0.18',
        currentDrawdown: '-0.04',
        peakDate: '2026-01-10',
        troughDate: '2026-03-10',
        recoveryDate: null,
      },
    },
    historicalVar95: metric('0.028'),
    historicalVar99: metric('0.046'),
    expectedShortfall95: metric('0.037'),
    concentration: {
      ...metric('0'),
      value: {
        largestPositionWeight: '0.46',
        top3Weight: '0.82',
        top5Weight: '0.92',
        hhi: '0.31',
        cashWeight: '0.18',
        unknownSectorWeight: '0',
        exposures: [
          {
            type: 'instrument',
            key: 'THYAO',
            weight: '0.46',
            marketValue: '2550',
            rank: 1,
          },
          {
            type: 'sector',
            key: 'Ulaştırma',
            weight: '0.46',
            marketValue: '2550',
            rank: null,
          },
          {
            type: 'cash',
            key: 'CASH_TRY',
            weight: '0.18',
            marketValue: '1000',
            rank: null,
          },
        ],
      },
    },
    warnings: [],
  };
}
