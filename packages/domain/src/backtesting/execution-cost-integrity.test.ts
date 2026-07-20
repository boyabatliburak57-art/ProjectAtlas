import { describe, expect, it } from 'vitest';

import type { ScanRuleAst } from '../scanner/ast/contracts.js';
import type {
  BacktestBar,
  BacktestCorporateActionEvent,
  BacktestCostPolicy,
  BacktestExecutionPlan,
  BacktestPointInTimePolicy,
  PointInTimeFundamentalRevision,
} from './contracts.js';
import {
  createBacktestDataSnapshotHash,
  isInstrumentEligibleAt,
  selectPointInTimeFundamental,
} from './data-integrity.js';
import { DeterministicBacktestEngine } from './engine.js';
import { ScannerBacktestSignalEvaluator } from './scanner-evaluator-adapter.js';

const engine = new DeterministicBacktestEngine(
  new ScannerBacktestSignalEvaluator(),
);

function rule(operator: 'GT' | 'LT', value: number): ScanRuleAst {
  return {
    version: 1,
    universe: {
      market: 'BIST',
      statuses: ['active'],
      indexCodes: [],
      sectorIds: [],
    },
    root: {
      type: 'group',
      nodeId: `root-${operator}-${value}`,
      operator: 'AND',
      children: [
        {
          type: 'condition',
          nodeId: `condition-${operator}-${value}`,
          operator,
          left: { type: 'priceField', field: 'close', timeframe: '1d' },
          right: { type: 'constantNumber', value },
        },
      ],
    },
  };
}

function plan(
  overrides: Partial<BacktestExecutionPlan> = {},
): BacktestExecutionPlan {
  return {
    runId: 'run-066',
    strategyRevisionId: 'strategy-revision-1',
    dataSnapshotHash: 'snapshot-066',
    engineVersion: 'engine-v2',
    executionPolicyVersion: 'closed-bar-next-open-v1',
    eventOrderingPolicyVersion: 'event-ordering-v1',
    roundingPolicyVersion: 'whole-share-half-even-v1',
    timeframe: '1d',
    initialCash: '1000',
    entryRule: rule('GT', 10),
    exitRule: rule('LT', 10),
    positionSizing: { type: 'fixedCash', amount: '500' },
    maxConcurrentPositions: 5,
    fractionalShares: false,
    allowShort: false,
    allowLeverage: false,
    liquidateAtEnd: false,
    ...overrides,
  };
}

function linearCost(
  overrides: Partial<Extract<BacktestCostPolicy, { type: 'linear' }>> = {},
): Extract<BacktestCostPolicy, { type: 'linear' }> {
  return {
    type: 'linear',
    version: 'linear-v1',
    commissionPercent: '0',
    minimumCommission: '0',
    fixedFee: '0',
    marketTaxPercent: '0',
    slippageBps: '0',
    ...overrides,
  };
}

function bar(
  day: number,
  close: string,
  overrides: Partial<BacktestBar> = {},
): BacktestBar {
  return {
    eventId: `AAA-bar-${day}`,
    type: 'bar',
    instrumentId: 'instrument-AAA',
    symbol: 'AAA',
    timestamp: `2025-01-${String(day).padStart(2, '0')}T15:00:00.000Z`,
    open: close,
    high: close,
    low: close,
    close,
    volume: '100000',
    isClosed: true,
    revision: 'r1',
    revisionAvailableAt: `2025-01-${String(day).padStart(2, '0')}T16:00:00.000Z`,
    ...overrides,
  };
}

function entryEvents(open = '10'): readonly BacktestBar[] {
  return [bar(1, '11'), bar(2, '11', { open, high: '11', low: open })];
}

function action(
  actionType: BacktestCorporateActionEvent['actionType'],
  overrides: Partial<BacktestCorporateActionEvent> = {},
): BacktestCorporateActionEvent {
  return {
    eventId: `action-${actionType}`,
    type: 'corporateAction',
    actionType,
    instrumentId: 'instrument-AAA',
    symbol: 'AAA',
    timestamp: '2025-01-03T15:00:00.000Z',
    announcementAt: '2024-12-01T00:00:00.000Z',
    exAt: '2025-01-03T00:00:00.000Z',
    effectiveAt: '2025-01-03T00:00:00.000Z',
    paymentAt: actionType === 'dividend' ? '2025-01-03T15:00:00.000Z' : null,
    revision: 'action-r1',
    revisionAvailableAt: '2024-12-02T00:00:00.000Z',
    factor: null,
    cashPerShare: null,
    settlementPrice: null,
    ...overrides,
  };
}

function pointInTimePolicy(
  overrides: Partial<BacktestPointInTimePolicy> = {},
): BacktestPointInTimePolicy {
  return {
    dataCutoffAt: '2025-12-31T23:59:59.000Z',
    universeVersion: 'universe-v1',
    membershipSnapshotHash: 'membership-hash-v1',
    requiredIndexCodes: ['XU100'],
    missingCoveragePolicy: 'exclude',
    instruments: [
      {
        instrumentId: 'instrument-AAA',
        listedAt: '2020-01-01T00:00:00.000Z',
        delistedAt: null,
        memberships: [
          {
            indexCode: 'XU100',
            effectiveFrom: '2024-01-01T00:00:00.000Z',
            effectiveTo: null,
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('TASK-066 execution cost, risk and liquidity fixtures', () => {
  it('1. applies percentage commission to fill notional', () => {
    const result = engine.run(
      plan({ costPolicy: linearCost({ commissionPercent: '1' }) }),
      entryEvents(),
    );
    expect(result.fills[0]).toMatchObject({ commission: '5', totalCosts: '5' });
    expect(result.state.cash).toBe('495');
  });

  it('2. applies minimum commission when percentage commission is lower', () => {
    const result = engine.run(
      plan({
        positionSizing: { type: 'fixedCash', amount: '100' },
        costPolicy: linearCost({
          commissionPercent: '0.1',
          minimumCommission: '2',
        }),
      }),
      entryEvents(),
    );
    expect(result.fills[0]?.commission).toBe('2');
  });

  it('3. increases buy fill price by fixed basis-point slippage', () => {
    const result = engine.run(
      plan({ costPolicy: linearCost({ slippageBps: '100' }) }),
      entryEvents(),
    );
    expect(result.fills[0]).toMatchObject({
      referencePrice: '10',
      price: '10.1',
      slippageAmount: '5',
    });
  });

  it('4. decreases sell fill price by fixed basis-point slippage', () => {
    const result = engine.run(
      plan({ costPolicy: linearCost({ slippageBps: '100' }) }),
      [
        ...entryEvents(),
        bar(3, '9'),
        bar(4, '9', { open: '10', high: '10', low: '9' }),
      ],
    );
    expect(result.fills.at(-1)).toMatchObject({
      side: 'SELL',
      referencePrice: '10',
      price: '9.9',
    });
  });

  it('5. applies fixed fee and market tax independently', () => {
    const result = engine.run(
      plan({
        costPolicy: linearCost({ fixedFee: '1', marketTaxPercent: '1' }),
      }),
      entryEvents(),
    );
    expect(result.fills[0]).toMatchObject({ fixedFee: '1', tax: '5' });
    expect(result.summary?.totalCosts).toBe('6');
  });

  it('6. rejects a buy when post-cost cash validation fails', () => {
    const result = engine.run(
      plan({
        initialCash: '500',
        costPolicy: linearCost({ minimumCommission: '1' }),
      }),
      entryEvents(),
    );
    expect(result.fills).toHaveLength(0);
    expect(result.state.cash).toBe('500');
    expect(
      result.warnings.some((item) => item.code === 'INSUFFICIENT_CASH'),
    ).toBe(true);
  });

  it('7. executes a stop loss using the conservative trigger price', () => {
    const result = engine.run(
      plan({
        riskPolicy: {
          stopLossPercent: '10',
          maximumPositionWeightPercent: '100',
          sameBarAmbiguityPolicy: 'stopFirst',
        },
      }),
      [bar(1, '11'), bar(2, '10', { open: '10', high: '11', low: '9' })],
    );
    expect(result.fills.at(-1)).toMatchObject({
      reason: 'stopLoss',
      price: '9',
    });
  });

  it('8. executes a take profit', () => {
    const result = engine.run(
      plan({
        riskPolicy: {
          takeProfitPercent: '10',
          maximumPositionWeightPercent: '100',
          sameBarAmbiguityPolicy: 'stopFirst',
        },
      }),
      [bar(1, '11'), bar(2, '10', { open: '10', high: '11', low: '10' })],
    );
    expect(result.fills.at(-1)).toMatchObject({
      reason: 'takeProfit',
      price: '11',
    });
  });

  it('9. updates and applies a trailing stop without future-bar data', () => {
    const result = engine.run(
      plan({
        riskPolicy: {
          trailingStopPercent: '10',
          maximumPositionWeightPercent: '100',
          sameBarAmbiguityPolicy: 'stopFirst',
        },
      }),
      [
        bar(1, '11'),
        bar(2, '12', { open: '10', high: '12', low: '10' }),
        bar(3, '11', { open: '11', high: '12', low: '10.8' }),
      ],
    );
    expect(result.fills.at(-1)).toMatchObject({
      reason: 'trailingStop',
      price: '10.8',
    });
  });

  it('10. exits at the configured maximum holding bars', () => {
    const result = engine.run(
      plan({
        riskPolicy: {
          maximumHoldingBars: 2,
          maximumPositionWeightPercent: '100',
          sameBarAmbiguityPolicy: 'stopFirst',
        },
      }),
      [bar(1, '11'), bar(2, '11', { open: '10' }), bar(3, '12')],
    );
    expect(result.fills.at(-1)).toMatchObject({
      reason: 'maximumHolding',
      filledAt: '2025-01-03T15:00:00.000Z',
    });
    const weightLimited = engine.run(
      plan({
        riskPolicy: {
          maximumPositionWeightPercent: '20',
          sameBarAmbiguityPolicy: 'stopFirst',
        },
      }),
      entryEvents(),
    );
    expect(weightLimited.fills[0]?.quantity).toBe('20');
  });

  it('11. applies deterministic volume participation partial fill', () => {
    const result = engine.run(
      plan({
        liquidityPolicy: {
          type: 'volumeParticipation',
          maximumParticipationPercent: '10',
          partialFillPolicy: 'deterministicFloor',
        },
      }),
      [bar(1, '11'), bar(2, '10', { volume: '100' })],
    );
    expect(result.fills[0]).toMatchObject({
      requestedQuantity: '50',
      quantity: '10',
      partial: true,
    });
  });

  it('12. reports missing volume instead of manufacturing liquidity', () => {
    const result = engine.run(
      plan({
        liquidityPolicy: {
          type: 'volumeParticipation',
          maximumParticipationPercent: '10',
          partialFillPolicy: 'deterministicFloor',
        },
      }),
      [bar(1, '11'), bar(2, '10', { volume: null })],
    );
    expect(result.fills).toHaveLength(0);
    expect(
      result.warnings.some(
        (item) => item.code === 'LIQUIDITY_VOLUME_UNAVAILABLE',
      ),
    ).toBe(true);
  });
});

describe('TASK-066 point-in-time and corporate-action bias fixtures', () => {
  it('13. uses historical index membership and excludes future membership', () => {
    const result = engine.run(
      plan({ pointInTimePolicy: pointInTimePolicy() }),
      entryEvents(),
    );
    const futureMembership = pointInTimePolicy({
      instruments: [
        {
          instrumentId: 'instrument-AAA',
          listedAt: '2020-01-01T00:00:00.000Z',
          delistedAt: null,
          memberships: [
            {
              indexCode: 'XU100',
              effectiveFrom: '2026-01-01T00:00:00.000Z',
              effectiveTo: null,
            },
          ],
        },
      ],
    });
    const excluded = engine.run(
      plan({ pointInTimePolicy: futureMembership }),
      entryEvents(),
    );
    expect(result.fills).toHaveLength(1);
    expect(excluded.fills).toHaveLength(0);
  });

  it('14. excludes a symbol before its listing date', () => {
    const policy = pointInTimePolicy({
      instruments: [
        {
          instrumentId: 'instrument-AAA',
          listedAt: '2026-01-01T00:00:00.000Z',
          delistedAt: null,
          memberships: [],
        },
      ],
      requiredIndexCodes: [],
    });
    const result = engine.run(
      plan({ pointInTimePolicy: policy }),
      entryEvents(),
    );
    expect(result.fills).toHaveLength(0);
  });

  it('15. includes a delisted symbol only inside its historical interval', () => {
    const policy = pointInTimePolicy({
      requiredIndexCodes: [],
      instruments: [
        {
          instrumentId: 'instrument-AAA',
          listedAt: '2020-01-01T00:00:00.000Z',
          delistedAt: '2025-06-01T00:00:00.000Z',
          memberships: [],
        },
      ],
    });
    expect(
      isInstrumentEligibleAt(
        policy,
        'instrument-AAA',
        '2025-01-01T00:00:00.000Z',
      ),
    ).toBe(true);
    expect(
      isInstrumentEligibleAt(
        policy,
        'instrument-AAA',
        '2025-07-01T00:00:00.000Z',
      ),
    ).toBe(false);
  });

  it('16. exposes fundamentals only after publication', () => {
    const revisions = fundamentalRevisions();
    expect(
      selectPointInTimeFundamental(revisions, {
        instrumentId: 'instrument-AAA',
        metricCode: 'revenue',
        asOf: '2025-02-01T00:00:00.000Z',
        dataCutoffAt: '2025-12-31T00:00:00.000Z',
      }),
    ).toBeNull();
    expect(
      selectPointInTimeFundamental(revisions, {
        instrumentId: 'instrument-AAA',
        metricCode: 'revenue',
        asOf: '2025-03-02T00:00:00.000Z',
        dataCutoffAt: '2025-12-31T00:00:00.000Z',
      })?.providerRevision,
    ).toBe('r1');
  });

  it('17. prevents a later restatement from leaking into earlier events', () => {
    const revisions = fundamentalRevisions();
    const before = selectPointInTimeFundamental(revisions, {
      instrumentId: 'instrument-AAA',
      metricCode: 'revenue',
      asOf: '2025-05-01T00:00:00.000Z',
      dataCutoffAt: '2025-12-31T00:00:00.000Z',
    });
    const after = selectPointInTimeFundamental(revisions, {
      instrumentId: 'instrument-AAA',
      metricCode: 'revenue',
      asOf: '2025-07-01T00:00:00.000Z',
      dataCutoffAt: '2025-12-31T00:00:00.000Z',
    });
    expect(before?.providerRevision).toBe('r1');
    expect(after?.providerRevision).toBe('r2');
  });

  it('18. applies a raw-price split without changing total cost basis', () => {
    const result = engine.run(
      plan({
        corporateActionPolicy: {
          version: 'ca-v1',
          adjustmentMode: 'raw',
          delistingPolicy: 'lastAvailableClose',
        },
      }),
      [...entryEvents(), action('split', { factor: '2' })],
    );
    expect(result.state.positions[0]).toMatchObject({
      quantity: '100',
      averageCost: '5',
      costBasis: '500',
    });
    const bonus = engine.run(plan(), [
      ...entryEvents(),
      action('bonusShare', { factor: '1.5' }),
    ]);
    expect(bonus.state.positions[0]).toMatchObject({
      quantity: '75',
      costBasis: '500',
    });
  });

  it('19. credits dividend cash on the available payment event', () => {
    const result = engine.run(plan(), [
      ...entryEvents(),
      action('dividend', { cashPerShare: '1' }),
    ]);
    expect(result.state.cash).toBe('550');
    const premature = engine.run(plan(), [
      ...entryEvents(),
      action('dividend', {
        cashPerShare: '1',
        paymentAt: '2025-01-04T15:00:00.000Z',
      }),
    ]);
    expect(premature.state.cash).toBe('500');
    expect(
      premature.warnings.some(
        (item) => item.code === 'CORPORATE_ACTION_NOT_AVAILABLE',
      ),
    ).toBe(true);
  });

  it('20. prevents adjusted prices and position adjustment double counting', () => {
    const result = engine.run(
      plan({
        corporateActionPolicy: {
          version: 'ca-v1',
          adjustmentMode: 'splitAdjusted',
          delistingPolicy: 'lastAvailableClose',
        },
      }),
      [...entryEvents(), action('split', { factor: '2' })],
    );
    expect(result.state.positions[0]?.quantity).toBe('50');
    expect(
      result.warnings.some(
        (item) => item.code === 'CORPORATE_ACTION_DOUBLE_APPLICATION_PREVENTED',
      ),
    ).toBe(true);
  });

  it('21. resolves same-bar high/low ambiguity with stop-first policy', () => {
    const result = engine.run(
      plan({
        riskPolicy: {
          stopLossPercent: '10',
          takeProfitPercent: '10',
          maximumPositionWeightPercent: '100',
          sameBarAmbiguityPolicy: 'stopFirst',
        },
      }),
      [bar(1, '11'), bar(2, '10', { open: '10', high: '11', low: '9' })],
    );
    expect(result.fills.at(-1)?.reason).toBe('stopLoss');
    expect(
      result.warnings.some((item) => item.code === 'SAME_BAR_RISK_AMBIGUITY'),
    ).toBe(true);
  });

  it('22. includes corrected bar revision in the deterministic timeline hash', () => {
    const firstBar = bar(1, '9', { revision: 'r1' });
    const correctedBar = bar(1, '9', { revision: 'r2', close: '11' });
    const firstSnapshot = createBacktestDataSnapshotHash({
      marketEvents: [firstBar],
      universeSnapshotHash: 'universe',
      fundamentalRevisionIds: [],
      corporateActionRevisionIds: [],
      dataCutoffAt: '2025-12-31T00:00:00.000Z',
    });
    const correctedSnapshot = createBacktestDataSnapshotHash({
      marketEvents: [correctedBar],
      universeSnapshotHash: 'universe',
      fundamentalRevisionIds: [],
      corporateActionRevisionIds: [],
      dataCutoffAt: '2025-12-31T00:00:00.000Z',
    });
    const first = engine.run(plan({ dataSnapshotHash: firstSnapshot }), [
      firstBar,
    ]);
    const corrected = engine.run(
      plan({ dataSnapshotHash: correctedSnapshot }),
      [correctedBar],
    );
    expect(correctedSnapshot).not.toBe(firstSnapshot);
    expect(corrected.timelineHash).not.toBe(first.timelineHash);
    expect(corrected.resultHash).not.toBe(first.resultHash);
  });

  it('23. does not turn a missing bar into a zero-price fill', () => {
    const result = engine.run(plan(), [
      bar(1, '11'),
      bar(2, '12', { open: null }),
      bar(3, '13', { open: '13' }),
    ]);
    expect(result.fills[0]).toMatchObject({
      referencePrice: '13',
      filledAt: '2025-01-03T15:00:00.000Z',
    });
  });

  it('24. applies the versioned delisting settlement policy', () => {
    const result = engine.run(
      plan({
        corporateActionPolicy: {
          version: 'ca-v1',
          adjustmentMode: 'raw',
          delistingPolicy: 'lastAvailableClose',
        },
      }),
      [...entryEvents(), action('delisting', { settlementPrice: '8' })],
    );
    expect(result.state.positions).toHaveLength(0);
    expect(result.trades[0]).toMatchObject({
      exitPrice: '8',
      exitReason: 'forcedExit',
    });
  });

  it('includes entry/exit fees and slippage in net trade P&L and expectancy', () => {
    const result = engine.run(
      plan({
        costPolicy: linearCost({ fixedFee: '1', slippageBps: '100' }),
      }),
      [
        ...entryEvents(),
        bar(3, '9'),
        bar(4, '9', { open: '10', high: '10', low: '9' }),
      ],
    );
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      grossPnl: '0',
      totalCosts: '12',
      realizedPnl: '-12',
    });
    expect(result.summary?.metrics.expectancy).toMatchObject({
      value: '-12',
      status: 'complete',
      observationCount: 1,
    });
  });
});

function fundamentalRevisions(): readonly PointInTimeFundamentalRevision[] {
  return [
    {
      instrumentId: 'instrument-AAA',
      metricCode: 'revenue',
      value: '100',
      periodEnd: '2024-12-31T00:00:00.000Z',
      publishedAt: '2025-03-01T00:00:00.000Z',
      providerRevision: 'r1',
      revisionAvailableAt: '2025-03-01T00:00:00.000Z',
    },
    {
      instrumentId: 'instrument-AAA',
      metricCode: 'revenue',
      value: '90',
      periodEnd: '2024-12-31T00:00:00.000Z',
      publishedAt: '2025-03-01T00:00:00.000Z',
      providerRevision: 'r2',
      revisionAvailableAt: '2025-06-01T00:00:00.000Z',
    },
  ];
}
