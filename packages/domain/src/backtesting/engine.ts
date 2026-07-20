import { createStableParameterHash } from '../indicators/parameter-hash.js';
import { Decimal, parseLedgerDecimal } from '../portfolio/decimal.js';
import type {
  BacktestBar,
  BacktestCheckpoint,
  BacktestCurvePoint,
  BacktestExecutionPlan,
  BacktestFill,
  BacktestOrderIntent,
  BacktestPosition,
  BacktestResult,
  BacktestRunOptions,
  BacktestSignalEvaluator,
  BacktestSimulationState,
  BacktestSummary,
  BacktestTimelineEvent,
  BacktestTrade,
  BacktestWarning,
} from './contracts.js';
import { BacktestDomainError } from './contracts.js';
import { isInstrumentEligibleAt } from './data-integrity.js';
import {
  calculateExecutionCosts,
  costPolicyOrDefault,
  type ExecutionCostCalculation,
} from './execution-cost.js';
import {
  createBacktestEventOrderKey,
  createOrderedBacktestTimeline,
} from './timeline.js';
import { calculateBacktestMetrics } from './metrics.js';

interface MutablePosition {
  instrumentId: string;
  symbol: string;
  quantity: Decimal;
  averageCost: Decimal;
  costBasis: Decimal;
  openedAt: string;
  entryFillId: string;
  highestClose: Decimal;
  holdingBars: number;
}

interface MutableSimulation {
  currentTime: string | null;
  cash: Decimal;
  positions: Map<string, MutablePosition>;
  pendingOrders: BacktestOrderIntent[];
  lastPrices: Map<string, Decimal>;
  realizedPnl: Decimal;
  processedEventIds: Set<string>;
  fills: BacktestFill[];
  trades: BacktestTrade[];
  equityCurve: BacktestCurvePoint[];
  cashCurve: BacktestCurvePoint[];
  exposureCurve: BacktestCurvePoint[];
  drawdownCurve: BacktestCurvePoint[];
  warnings: BacktestWarning[];
  warningKeys: Set<string>;
  lastProcessedOrderKey: string | null;
}

export class DeterministicBacktestEngine {
  constructor(private readonly signalEvaluator: BacktestSignalEvaluator) {}

  run(
    plan: BacktestExecutionPlan,
    inputEvents: readonly BacktestTimelineEvent[],
    options: BacktestRunOptions = {},
  ): BacktestResult {
    validatePlan(plan);
    const timeline = createOrderedBacktestTimeline(inputEvents);
    const planHash = createStableParameterHash(plan);
    const simulation = options.checkpoint
      ? restoreCheckpoint(options.checkpoint, planHash, timeline.hash, plan)
      : createSimulation(plan);
    addDuplicateWarnings(
      simulation,
      timeline.events,
      timeline.duplicateEventIds,
    );

    const histories = restoreHistories(
      timeline.events,
      simulation.processedEventIds,
    );
    const buckets = groupUnprocessedEvents(
      timeline.events,
      simulation.processedEventIds,
    );
    const bucketLimit = options.stopAfterTimestampBuckets ?? buckets.length;
    if (!Number.isInteger(bucketLimit) || bucketLimit < 0) {
      throw new BacktestDomainError('BACKTEST_PLAN_INVALID', {
        field: 'stopAfterTimestampBuckets',
      });
    }

    let processedBuckets = 0;
    for (const bucket of buckets) {
      if (processedBuckets >= bucketLimit) break;
      this.processTimestampBucket(plan, bucket, histories, simulation);
      processedBuckets += 1;
    }

    const completed = processedBuckets === buckets.length;
    if (completed && plan.liquidateAtEnd) liquidateAtEnd(plan, simulation);
    const state = snapshotState(simulation);
    const metricCalculation = completed
      ? calculateBacktestMetrics({
          initialEquity: plan.initialCash,
          endingEquity: currentEquity(simulation).toString(),
          equityCurve: simulation.equityCurve,
          drawdownCurve: simulation.drawdownCurve,
          fills: simulation.fills,
          trades: simulation.trades,
          benchmark: plan.benchmark,
          adjustmentMode: plan.corporateActionPolicy?.adjustmentMode ?? 'raw',
          dataCutoffAt: plan.pointInTimePolicy?.dataCutoffAt,
        })
      : null;
    const summary =
      metricCalculation === null
        ? null
        : createSummary(plan, simulation, metricCalculation);
    const checkpoint = createCheckpoint(
      plan,
      planHash,
      timeline.hash,
      simulation,
      state,
    );
    const resultPayload = {
      planHash,
      timelineHash: timeline.hash,
      state,
      fills: simulation.fills,
      trades: simulation.trades,
      equityCurve: simulation.equityCurve,
      cashCurve: simulation.cashCurve,
      exposureCurve: simulation.exposureCurve,
      drawdownCurve: simulation.drawdownCurve,
      benchmarkCurve: metricCalculation?.benchmarkCurve ?? [],
      warnings: simulation.warnings,
      summary,
    };
    return {
      status: completed ? 'completed' : 'checkpointed',
      ...resultPayload,
      resultHash: createStableParameterHash(resultPayload),
      checkpoint,
    };
  }

  private processTimestampBucket(
    plan: BacktestExecutionPlan,
    events: readonly BacktestTimelineEvent[],
    histories: Map<string, BacktestBar[]>,
    simulation: MutableSimulation,
  ): void {
    const timestamp = events[0]!.timestamp;
    simulation.currentTime = timestamp;

    const bars: BacktestBar[] = [];
    for (const event of events) {
      if (event.type === 'corporateAction')
        applyCorporateAction(plan, simulation, event);
      else if (event.type === 'forcedExit')
        executeForcedExit(plan, simulation, event);
      else bars.push(event);
    }
    // The timeline's stable order already sorts equal-priority bars by
    // instrument, so no per-bucket copy/sort is required here.
    executePendingOrders(plan, bars, simulation);
    executeRiskExits(plan, bars, simulation);

    for (const bar of bars) {
      if (!bar.isClosed) {
        addWarning(simulation, warning('BAR_NOT_CLOSED', bar));
        continue;
      }
      const history = histories.get(bar.instrumentId) ?? [];
      history.push(bar);
      histories.set(bar.instrumentId, history);
      const close = optionalPrice(bar.close, 'close');
      if (close !== null) simulation.lastPrices.set(bar.instrumentId, close);
    }

    for (const bar of bars) {
      if (!bar.isClosed) continue;
      this.evaluateSignals(
        plan,
        bar,
        histories.get(bar.instrumentId) ?? [],
        simulation,
      );
    }
    simulation.pendingOrders.sort(compareOrders);

    for (const event of events) simulation.processedEventIds.add(event.eventId);
    const lastEvent = events.at(-1);
    if (lastEvent !== undefined)
      simulation.lastProcessedOrderKey = createBacktestEventOrderKey(lastEvent);
    recordCurves(timestamp, simulation);
  }

  private evaluateSignals(
    plan: BacktestExecutionPlan,
    bar: BacktestBar,
    history: readonly BacktestBar[],
    simulation: MutableSimulation,
  ): void {
    const context = {
      instrumentId: bar.instrumentId,
      symbol: bar.symbol,
      signalAt: bar.timestamp,
      timeframe: plan.timeframe,
      bars: history,
    } as const;
    const position = simulation.positions.get(bar.instrumentId);
    if (
      position !== undefined &&
      !hasPending(simulation, bar.instrumentId, 'SELL')
    ) {
      const exit = this.signalEvaluator.evaluate(plan.exitRule, context);
      if (exit.status === 'matched') {
        simulation.pendingOrders.push(orderIntent(plan, bar, 'SELL', 'exit'));
      } else if (exit.status === 'notEvaluable') {
        addWarning(simulation, warning('SIGNAL_NOT_EVALUABLE', bar));
      }
      return;
    }
    if (
      position === undefined &&
      isInstrumentEligibleAt(
        plan.pointInTimePolicy,
        bar.instrumentId,
        bar.timestamp,
      ) &&
      !hasPending(simulation, bar.instrumentId, 'BUY')
    ) {
      const entry = this.signalEvaluator.evaluate(plan.entryRule, context);
      if (entry.status === 'matched') {
        simulation.pendingOrders.push(orderIntent(plan, bar, 'BUY', 'entry'));
      } else if (entry.status === 'notEvaluable') {
        addWarning(simulation, warning('SIGNAL_NOT_EVALUABLE', bar));
      }
    } else if (
      position === undefined &&
      !isInstrumentEligibleAt(
        plan.pointInTimePolicy,
        bar.instrumentId,
        bar.timestamp,
      )
    ) {
      addWarning(simulation, warning('HISTORICAL_UNIVERSE_EXCLUDED', bar));
    }
  }
}

function executePendingOrders(
  plan: BacktestExecutionPlan,
  bars: readonly BacktestBar[],
  simulation: MutableSimulation,
): void {
  const barsByInstrument = new Map(bars.map((bar) => [bar.instrumentId, bar]));
  const remaining: BacktestOrderIntent[] = [];
  for (const order of [...simulation.pendingOrders].sort(compareOrders)) {
    const bar = barsByInstrument.get(order.instrumentId);
    if (bar === undefined || !bar.isClosed || bar.timestamp <= order.signalAt) {
      remaining.push(order);
      continue;
    }
    if (
      order.side === 'BUY' &&
      !isInstrumentEligibleAt(
        plan.pointInTimePolicy,
        order.instrumentId,
        bar.timestamp,
      )
    ) {
      addWarning(simulation, warning('HISTORICAL_UNIVERSE_EXCLUDED', bar));
      continue;
    }
    const price = optionalPrice(bar.open, 'open');
    if (price === null) {
      addWarning(simulation, warning('MISSING_EXECUTION_PRICE', bar));
      remaining.push(order);
      continue;
    }
    if (order.side === 'SELL')
      executeSell(plan, simulation, order, price, bar.timestamp, 'exit', bar);
    else if (!executeBuy(plan, simulation, order, price, bar))
      remaining.push(order);
  }
  simulation.pendingOrders = remaining;
}

function executeBuy(
  plan: BacktestExecutionPlan,
  simulation: MutableSimulation,
  order: BacktestOrderIntent,
  price: Decimal,
  bar: BacktestBar,
): boolean {
  if (simulation.positions.has(order.instrumentId)) return true;
  if (simulation.positions.size >= plan.maxConcurrentPositions) {
    addWarning(simulation, warning('MAX_POSITIONS_REACHED', bar));
    return true;
  }
  const sizing = sizingBudget(plan, simulation);
  if (
    plan.positionSizing.type === 'fixedCash' &&
    sizing.compare(simulation.cash) > 0
  ) {
    addWarning(simulation, warning('INSUFFICIENT_CASH', bar));
    return true;
  }
  const maximumWeight = plan.riskPolicy
    ? nonNegativeDecimal(
        plan.riskPolicy.maximumPositionWeightPercent,
        'maximumPositionWeightPercent',
      )
    : Decimal.parse('100');
  const weightBudget = currentEquity(simulation)
    .times(maximumWeight)
    .dividedBy(Decimal.parse('100'));
  const budget = sizing.compare(weightBudget) > 0 ? weightBudget : sizing;
  const spendable =
    budget.compare(simulation.cash) > 0 ? simulation.cash : budget;
  const requestedQuantity = floorPositiveInteger(spendable.dividedBy(price));
  if (requestedQuantity.isZero()) {
    addWarning(simulation, warning('INSUFFICIENT_CASH', bar));
    return true;
  }
  const quantity = applyParticipationLimit(
    plan,
    requestedQuantity,
    bar,
    simulation,
  );
  if (quantity === null || quantity.isZero()) return true;
  const costs = calculateExecutionCosts({
    side: 'BUY',
    quantity,
    referencePrice: price,
    policy: costPolicyOrDefault(plan.costPolicy),
  });
  if (costs.cashRequired.compare(simulation.cash) > 0) {
    addWarning(simulation, warning('INSUFFICIENT_CASH', bar));
    return true;
  }
  const fill = createFill(
    order,
    requestedQuantity,
    quantity,
    costs,
    bar.timestamp,
    'entry',
  );
  if (hasFill(simulation, fill.deduplicationKey)) return true;
  simulation.cash = simulation.cash.minus(costs.cashRequired);
  simulation.positions.set(order.instrumentId, {
    instrumentId: order.instrumentId,
    symbol: order.symbol,
    quantity,
    averageCost: costs.cashRequired.dividedBy(quantity),
    costBasis: costs.cashRequired,
    openedAt: bar.timestamp,
    entryFillId: fill.id,
    highestClose: costs.fillPrice,
    holdingBars: 0,
  });
  simulation.fills.push(fill);
  return true;
}

function executeSell(
  plan: BacktestExecutionPlan,
  simulation: MutableSimulation,
  order: BacktestOrderIntent,
  price: Decimal,
  filledAt: string,
  reason: Exclude<BacktestFill['reason'], 'entry'>,
  bar?: BacktestBar,
): void {
  const position = simulation.positions.get(order.instrumentId);
  if (position === undefined) return;
  const requestedQuantity = position.quantity;
  const quantity =
    bar === undefined
      ? requestedQuantity
      : applyParticipationLimit(plan, requestedQuantity, bar, simulation);
  if (quantity === null || quantity.isZero()) return;
  const costs = calculateExecutionCosts({
    side: 'SELL',
    quantity,
    referencePrice: price,
    policy: costPolicyOrDefault(plan.costPolicy),
  });
  const fill = createFill(
    order,
    requestedQuantity,
    quantity,
    costs,
    filledAt,
    reason,
  );
  if (hasFill(simulation, fill.deduplicationKey)) return;
  const soldCost = position.averageCost.times(quantity);
  const pnl = costs.netProceeds.minus(soldCost);
  simulation.cash = simulation.cash.plus(costs.netProceeds);
  simulation.realizedPnl = simulation.realizedPnl.plus(pnl);
  const remainingQuantity = position.quantity.minus(quantity);
  if (remainingQuantity.isZero())
    simulation.positions.delete(order.instrumentId);
  else {
    position.quantity = remainingQuantity;
    position.costBasis = remainingQuantity.times(position.averageCost);
  }
  simulation.fills.push(fill);
  const entryFill = simulation.fills.find(
    (item) => item.id === position.entryFillId,
  );
  const allocatedEntryCosts = entryFill
    ? Decimal.parse(entryFill.totalCosts)
        .times(quantity)
        .dividedBy(Decimal.parse(entryFill.quantity))
    : Decimal.ZERO;
  const totalCosts = allocatedEntryCosts.plus(Decimal.parse(fill.totalCosts));
  const trade: BacktestTrade = {
    id: `trade:${createStableParameterHash({ entryFillId: position.entryFillId, exitFillId: fill.id })}`,
    instrumentId: position.instrumentId,
    symbol: position.symbol,
    quantity: decimalString(quantity, 'quantity'),
    entryPrice: decimalString(position.averageCost, 'entryPrice'),
    exitPrice: decimalString(costs.fillPrice, 'exitPrice'),
    openedAt: position.openedAt,
    closedAt: filledAt,
    realizedPnl: decimalString(pnl, 'realizedPnl'),
    grossPnl: decimalString(pnl.plus(totalCosts), 'grossPnl'),
    totalCosts: decimalString(totalCosts, 'totalCosts'),
    returnPercent: decimalString(
      pnl.dividedBy(soldCost).times(Decimal.parse('100')),
      'returnPercent',
    ),
    exitReason: reason,
    entryFillId: position.entryFillId,
    exitFillId: fill.id,
  };
  if (!simulation.trades.some((item) => item.id === trade.id))
    simulation.trades.push(trade);
}

function executeRiskExits(
  plan: BacktestExecutionPlan,
  bars: readonly BacktestBar[],
  simulation: MutableSimulation,
): void {
  const policy = plan.riskPolicy;
  if (policy === undefined) return;
  for (const bar of [...bars].sort(compareInstrument)) {
    if (!bar.isClosed) continue;
    const position = simulation.positions.get(bar.instrumentId);
    if (position === undefined) continue;
    const open = optionalPrice(bar.open, 'open');
    const high = optionalPrice(bar.high, 'high');
    const low = optionalPrice(bar.low, 'low');
    const close = optionalPrice(bar.close, 'close');
    if (open === null || high === null || low === null || close === null)
      continue;
    position.holdingBars += 1;
    const hundred = Decimal.parse('100');
    const stopPrice = policy.stopLossPercent
      ? position.averageCost.times(
          Decimal.parse('1').minus(
            positiveDecimal(
              policy.stopLossPercent,
              'stopLossPercent',
            ).dividedBy(hundred),
          ),
        )
      : null;
    const takePrice = policy.takeProfitPercent
      ? position.averageCost.times(
          Decimal.parse('1').plus(
            positiveDecimal(
              policy.takeProfitPercent,
              'takeProfitPercent',
            ).dividedBy(hundred),
          ),
        )
      : null;
    const trailingPrice = policy.trailingStopPercent
      ? position.highestClose.times(
          Decimal.parse('1').minus(
            positiveDecimal(
              policy.trailingStopPercent,
              'trailingStopPercent',
            ).dividedBy(hundred),
          ),
        )
      : null;
    const protectivePrice = maximumDecimal(stopPrice, trailingPrice);
    const protectiveTriggered =
      protectivePrice !== null && low.compare(protectivePrice) <= 0;
    const takeTriggered = takePrice !== null && high.compare(takePrice) >= 0;
    if (protectiveTriggered && takeTriggered) {
      addWarning(simulation, warning('SAME_BAR_RISK_AMBIGUITY', bar));
    }
    const riskReason =
      protectiveTriggered && trailingPrice === protectivePrice
        ? 'trailingStop'
        : protectiveTriggered
          ? 'stopLoss'
          : takeTriggered
            ? 'takeProfit'
            : policy.maximumHoldingBars !== undefined &&
                position.holdingBars >= policy.maximumHoldingBars
              ? 'maximumHolding'
              : null;
    if (riskReason !== null) {
      const threshold = protectiveTriggered
        ? protectivePrice
        : takeTriggered
          ? takePrice
          : close;
      const executionPrice =
        protectiveTriggered && open.compare(threshold) < 0
          ? open
          : takeTriggered && open.compare(threshold) > 0
            ? open
            : threshold;
      const order = riskOrder(plan, bar, riskReason);
      executeSell(
        plan,
        simulation,
        order,
        executionPrice,
        bar.timestamp,
        riskReason,
        bar,
      );
      simulation.pendingOrders = simulation.pendingOrders.filter(
        (item) => item.instrumentId !== bar.instrumentId,
      );
      continue;
    }
    if (close.compare(position.highestClose) > 0) position.highestClose = close;
  }
}

function riskOrder(
  plan: BacktestExecutionPlan,
  bar: BacktestBar,
  reason: Exclude<
    BacktestFill['reason'],
    'entry' | 'exit' | 'forcedExit' | 'endOfTest'
  >,
): BacktestOrderIntent {
  const id = `risk:${createStableParameterHash({
    runId: plan.runId,
    eventId: bar.eventId,
    instrumentId: bar.instrumentId,
    reason,
  })}`;
  return {
    id,
    instrumentId: bar.instrumentId,
    symbol: bar.symbol,
    side: 'SELL',
    signalAt: bar.timestamp,
    signalEventId: bar.eventId,
    reason: 'exit',
  };
}

function applyCorporateAction(
  plan: BacktestExecutionPlan,
  simulation: MutableSimulation,
  event: Extract<BacktestTimelineEvent, { type: 'corporateAction' }>,
): void {
  const cutoff = plan.pointInTimePolicy?.dataCutoffAt;
  if (
    Date.parse(event.revisionAvailableAt) > Date.parse(event.timestamp) ||
    Date.parse(event.timestamp) < Date.parse(event.effectiveAt) ||
    (event.actionType === 'dividend' &&
      (event.paymentAt === null ||
        Date.parse(event.timestamp) < Date.parse(event.paymentAt))) ||
    (cutoff !== undefined &&
      Date.parse(event.revisionAvailableAt) > Date.parse(cutoff))
  ) {
    addWarning(simulation, warning('CORPORATE_ACTION_NOT_AVAILABLE', event));
    return;
  }
  const position = simulation.positions.get(event.instrumentId);
  if (position === undefined) return;
  const policy = plan.corporateActionPolicy ?? {
    version: 'corporate-action-v1',
    adjustmentMode: 'raw' as const,
    delistingPolicy: 'lastAvailableClose' as const,
  };
  if (event.actionType === 'split' || event.actionType === 'bonusShare') {
    if (policy.adjustmentMode !== 'raw') {
      addWarning(
        simulation,
        warning('CORPORATE_ACTION_DOUBLE_APPLICATION_PREVENTED', event),
      );
      return;
    }
    const factor = positiveDecimal(
      event.factor ?? '',
      'corporateAction.factor',
    );
    position.quantity = position.quantity.times(factor);
    position.averageCost = position.averageCost.dividedBy(factor);
    position.highestClose = position.highestClose.dividedBy(factor);
    return;
  }
  if (event.actionType === 'dividend') {
    if (policy.adjustmentMode === 'totalReturnAdjusted') {
      addWarning(
        simulation,
        warning('CORPORATE_ACTION_DOUBLE_APPLICATION_PREVENTED', event),
      );
      return;
    }
    const cashPerShare = positiveDecimal(
      event.cashPerShare ?? '',
      'corporateAction.cashPerShare',
    );
    simulation.cash = simulation.cash.plus(
      position.quantity.times(cashPerShare),
    );
    return;
  }
  if (policy.delistingPolicy === 'notEvaluable') {
    addWarning(simulation, warning('DELISTING_NOT_EVALUABLE', event));
    return;
  }
  const settlement =
    policy.delistingPolicy === 'writeOff'
      ? Decimal.ZERO
      : event.settlementPrice === null
        ? simulation.lastPrices.get(event.instrumentId)
        : positiveDecimal(event.settlementPrice, 'settlementPrice');
  if (settlement === undefined) {
    addWarning(simulation, warning('DELISTING_NOT_EVALUABLE', event));
    return;
  }
  const order: BacktestOrderIntent = {
    id: `delisting:${event.eventId}`,
    instrumentId: event.instrumentId,
    symbol: event.symbol,
    side: 'SELL',
    signalAt: event.timestamp,
    signalEventId: event.eventId,
    reason: 'exit',
  };
  executeSell(
    plan,
    simulation,
    order,
    settlement,
    event.timestamp,
    'forcedExit',
  );
  simulation.pendingOrders = simulation.pendingOrders.filter(
    (item) => item.instrumentId !== event.instrumentId,
  );
}

function executeForcedExit(
  plan: BacktestExecutionPlan,
  simulation: MutableSimulation,
  event: Extract<BacktestTimelineEvent, { type: 'forcedExit' }>,
): void {
  if (!simulation.positions.has(event.instrumentId)) return;
  const price = optionalPrice(event.price, 'forcedExitPrice');
  if (price === null) {
    addWarning(simulation, warning('FORCED_EXIT_PRICE_MISSING', event));
    return;
  }
  const order: BacktestOrderIntent = {
    id: `forced:${event.eventId}`,
    instrumentId: event.instrumentId,
    symbol: event.symbol,
    side: 'SELL',
    signalAt: event.timestamp,
    signalEventId: event.eventId,
    reason: 'exit',
  };
  executeSell(plan, simulation, order, price, event.timestamp, 'forcedExit');
  simulation.pendingOrders = simulation.pendingOrders.filter(
    (item) => item.instrumentId !== event.instrumentId,
  );
}

function liquidateAtEnd(
  plan: BacktestExecutionPlan,
  simulation: MutableSimulation,
): void {
  if (simulation.currentTime === null) return;
  for (const position of [...simulation.positions.values()].sort(
    compareInstrument,
  )) {
    const price = simulation.lastPrices.get(position.instrumentId);
    if (price === undefined) continue;
    const order: BacktestOrderIntent = {
      id: `liquidation:${plan.runId}:${position.instrumentId}:${simulation.currentTime}`,
      instrumentId: position.instrumentId,
      symbol: position.symbol,
      side: 'SELL',
      signalAt: simulation.currentTime,
      signalEventId: `end:${simulation.currentTime}`,
      reason: 'exit',
    };
    executeSell(
      plan,
      simulation,
      order,
      price,
      simulation.currentTime,
      'endOfTest',
    );
  }
  simulation.pendingOrders = [];
  recordCurves(simulation.currentTime, simulation);
}

function sizingBudget(
  plan: BacktestExecutionPlan,
  simulation: MutableSimulation,
): Decimal {
  if (plan.positionSizing.type === 'fixedCash') {
    return positiveDecimal(plan.positionSizing.amount, 'positionSizing.amount');
  }
  const equity = currentEquity(simulation);
  if (plan.positionSizing.type === 'fixedPercentage') {
    return equity
      .times(
        positiveDecimal(plan.positionSizing.percent, 'positionSizing.percent'),
      )
      .dividedBy(Decimal.parse('100'));
  }
  return equity.dividedBy(Decimal.parse(String(plan.maxConcurrentPositions)));
}

function recordCurves(timestamp: string, simulation: MutableSimulation): void {
  const equity = currentEquity(simulation);
  let exposure = Decimal.ZERO;
  for (const position of simulation.positions.values()) {
    const price = simulation.lastPrices.get(position.instrumentId);
    if (price !== undefined)
      exposure = exposure.plus(position.quantity.times(price));
  }
  const exposurePercent = equity.isZero()
    ? Decimal.ZERO
    : exposure.dividedBy(equity).times(Decimal.parse('100'));
  const priorPeak = simulation.equityCurve.reduce((peak, point) => {
    const value = Decimal.parse(point.value);
    return value.compare(peak) > 0 ? value : peak;
  }, equity);
  const peak = equity.compare(priorPeak) > 0 ? equity : priorPeak;
  const drawdown = peak.isZero()
    ? Decimal.ZERO
    : equity.minus(peak).dividedBy(peak).times(Decimal.parse('100'));
  upsertCurve(simulation.equityCurve, timestamp, equity);
  upsertCurve(simulation.cashCurve, timestamp, simulation.cash);
  upsertCurve(simulation.exposureCurve, timestamp, exposurePercent);
  upsertCurve(simulation.drawdownCurve, timestamp, drawdown);
}

function currentEquity(simulation: MutableSimulation): Decimal {
  let equity = simulation.cash;
  for (const position of simulation.positions.values()) {
    const price =
      simulation.lastPrices.get(position.instrumentId) ?? position.averageCost;
    equity = equity.plus(position.quantity.times(price));
  }
  return equity;
}

function createSummary(
  plan: BacktestExecutionPlan,
  simulation: MutableSimulation,
  metricCalculation: ReturnType<typeof calculateBacktestMetrics>,
): BacktestSummary {
  const initial = positiveDecimal(plan.initialCash, 'initialCash');
  const ending = currentEquity(simulation);
  const wins = simulation.trades.filter(
    (trade) => Decimal.parse(trade.realizedPnl).compare(Decimal.ZERO) > 0,
  );
  const losses = simulation.trades.filter(
    (trade) => Decimal.parse(trade.realizedPnl).compare(Decimal.ZERO) < 0,
  );
  const grossProfit = wins.reduce(
    (total, trade) => total.plus(Decimal.parse(trade.realizedPnl)),
    Decimal.ZERO,
  );
  const grossLoss = losses.reduce(
    (total, trade) => total.minus(Decimal.parse(trade.realizedPnl)),
    Decimal.ZERO,
  );
  const minimumDrawdown = simulation.drawdownCurve.reduce((minimum, point) => {
    const value = Decimal.parse(point.value);
    return value.compare(minimum) < 0 ? value : minimum;
  }, Decimal.ZERO);
  const averageExposure =
    simulation.exposureCurve.length === 0
      ? Decimal.ZERO
      : simulation.exposureCurve
          .reduce(
            (total, point) => total.plus(Decimal.parse(point.value)),
            Decimal.ZERO,
          )
          .dividedBy(Decimal.parse(String(simulation.exposureCurve.length)));
  return {
    initialCash: decimalString(initial, 'initialCash'),
    endingCash: decimalString(simulation.cash, 'endingCash'),
    endingEquity: decimalString(ending, 'endingEquity'),
    totalReturnPercent: decimalString(
      ending.minus(initial).dividedBy(initial).times(Decimal.parse('100')),
      'totalReturnPercent',
    ),
    maximumDrawdownPercent: decimalString(
      minimumDrawdown.times(Decimal.parse('-1')),
      'maximumDrawdownPercent',
    ),
    realizedPnl: decimalString(simulation.realizedPnl, 'realizedPnl'),
    tradeCount: simulation.trades.length,
    winningTradeCount: wins.length,
    losingTradeCount: losses.length,
    winRatePercent:
      simulation.trades.length === 0
        ? '0'
        : decimalString(
            Decimal.parse(String(wins.length))
              .dividedBy(Decimal.parse(String(simulation.trades.length)))
              .times(Decimal.parse('100')),
            'winRatePercent',
          ),
    profitFactor: grossLoss.isZero()
      ? null
      : decimalString(grossProfit.dividedBy(grossLoss), 'profitFactor'),
    exposurePercent: decimalString(averageExposure, 'exposurePercent'),
    totalCosts: decimalString(
      simulation.fills.reduce(
        (total, fill) => total.plus(Decimal.parse(fill.totalCosts)),
        Decimal.ZERO,
      ),
      'totalCosts',
    ),
    metrics: metricCalculation.metrics,
    methodology: metricCalculation.methodology,
  };
}

function createSimulation(plan: BacktestExecutionPlan): MutableSimulation {
  const costFree = costPolicyOrDefault(plan.costPolicy).type === 'costFree';
  return {
    currentTime: null,
    cash: positiveDecimal(plan.initialCash, 'initialCash'),
    positions: new Map(),
    pendingOrders: [],
    lastPrices: new Map(),
    realizedPnl: Decimal.ZERO,
    processedEventIds: new Set(),
    fills: [],
    trades: [],
    equityCurve: [],
    cashCurve: [],
    exposureCurve: [],
    drawdownCurve: [],
    warnings: costFree
      ? [
          {
            code: 'COST_FREE_BACKTEST',
            eventId: `run:${plan.runId}`,
            instrumentId: '*',
          },
        ]
      : [],
    warningKeys: new Set(costFree ? ['COST_FREE_BACKTEST:*'] : []),
    lastProcessedOrderKey: null,
  };
}

function snapshotState(simulation: MutableSimulation): BacktestSimulationState {
  return {
    currentTime: simulation.currentTime,
    cash: decimalString(simulation.cash, 'cash'),
    positions: [...simulation.positions.values()]
      .sort(compareInstrument)
      .map(snapshotPosition),
    pendingOrders: [...simulation.pendingOrders].sort(compareOrders),
    lastPrices: Object.fromEntries(
      [...simulation.lastPrices.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([instrumentId, price]) => [
          instrumentId,
          decimalString(price, 'lastPrice'),
        ]),
    ),
    realizedPnl: decimalString(simulation.realizedPnl, 'realizedPnl'),
  };
}

function createCheckpoint(
  plan: BacktestExecutionPlan,
  planHash: string,
  timelineHash: string,
  simulation: MutableSimulation,
  state: BacktestSimulationState,
): BacktestCheckpoint {
  const payload = {
    engineVersion: plan.engineVersion,
    planHash,
    timelineHash,
    lastProcessedOrderKey: simulation.lastProcessedOrderKey,
    // Events enter this Set in deterministic timeline order. Retaining insertion
    // order avoids an O(n log n) sort at every durable checkpoint.
    processedEventIds: [...simulation.processedEventIds],
    state,
    fills: simulation.fills,
    trades: simulation.trades,
    equityCurve: simulation.equityCurve,
    cashCurve: simulation.cashCurve,
    exposureCurve: simulation.exposureCurve,
    drawdownCurve: simulation.drawdownCurve,
    warnings: simulation.warnings,
  };
  return {
    version: 1,
    ...payload,
    stateHash: createStableParameterHash(checkpointHashPayload(payload)),
  };
}

function restoreCheckpoint(
  checkpoint: BacktestCheckpoint,
  planHash: string,
  timelineHash: string,
  plan: BacktestExecutionPlan,
): MutableSimulation {
  if (
    checkpoint.version !== 1 ||
    checkpoint.planHash !== planHash ||
    checkpoint.timelineHash !== timelineHash ||
    checkpoint.engineVersion !== plan.engineVersion
  ) {
    throw new BacktestDomainError('BACKTEST_CHECKPOINT_MISMATCH');
  }
  if (
    createStableParameterHash(checkpointHashPayload(checkpoint)) !==
    checkpoint.stateHash
  ) {
    throw new BacktestDomainError('BACKTEST_CHECKPOINT_INVALID');
  }
  return {
    currentTime: checkpoint.state.currentTime,
    cash: parseLedgerDecimal(checkpoint.state.cash, 'checkpoint.cash', {
      nonNegative: true,
    }),
    positions: new Map(
      checkpoint.state.positions.map((position) => [
        position.instrumentId,
        {
          ...position,
          quantity: positiveDecimal(position.quantity, 'checkpoint.quantity'),
          averageCost: positiveDecimal(
            position.averageCost,
            'checkpoint.averageCost',
          ),
          costBasis: positiveDecimal(
            position.costBasis,
            'checkpoint.costBasis',
          ),
          highestClose: positiveDecimal(
            position.highestClose,
            'checkpoint.highestClose',
          ),
        },
      ]),
    ),
    pendingOrders: [...checkpoint.state.pendingOrders],
    lastPrices: new Map(
      Object.entries(checkpoint.state.lastPrices).map(([id, value]) => [
        id,
        positiveDecimal(value, 'checkpoint.lastPrice'),
      ]),
    ),
    realizedPnl: Decimal.parse(checkpoint.state.realizedPnl),
    processedEventIds: new Set(checkpoint.processedEventIds),
    fills: [...checkpoint.fills],
    trades: [...checkpoint.trades],
    equityCurve: [...checkpoint.equityCurve],
    cashCurve: [...checkpoint.cashCurve],
    exposureCurve: [...checkpoint.exposureCurve],
    drawdownCurve: [...checkpoint.drawdownCurve],
    warnings: [...checkpoint.warnings],
    warningKeys: new Set(
      checkpoint.warnings.map((item) => `${item.code}:${item.instrumentId}`),
    ),
    lastProcessedOrderKey: checkpoint.lastProcessedOrderKey,
  };
}

function checkpointHashPayload(
  checkpoint: Omit<BacktestCheckpoint, 'version' | 'stateHash'>,
): object {
  return {
    engineVersion: checkpoint.engineVersion,
    planHash: checkpoint.planHash,
    timelineHash: checkpoint.timelineHash,
    lastProcessedOrderKey: checkpoint.lastProcessedOrderKey,
    processedEventIdsHash: hashStringSequence(checkpoint.processedEventIds),
    state: checkpoint.state,
    fills: checkpoint.fills,
    trades: checkpoint.trades,
    equityCurve: checkpoint.equityCurve,
    cashCurve: checkpoint.cashCurve,
    exposureCurve: checkpoint.exposureCurve,
    drawdownCurve: checkpoint.drawdownCurve,
    warnings: checkpoint.warnings,
  };
}

function hashStringSequence(values: readonly string[]): string {
  let first = 0x81_1c_9d_c5;
  let second = 0x9e_37_79_b9;
  const updateByte = (value: number): void => {
    first = Math.imul(first ^ value, 0x01_00_01_93) >>> 0;
    second = Math.imul(second ^ value, 0x01_00_01_93) >>> 0;
  };
  for (const value of values) {
    let length = value.length;
    do {
      updateByte(length & 0xff);
      length >>>= 8;
    } while (length > 0);
    updateByte(0xff);
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      updateByte(code & 0xff);
      updateByte(code >>> 8);
    }
    updateByte(0xfe);
  }
  return `fnv1a64:${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}

function validatePlan(plan: BacktestExecutionPlan): void {
  positiveDecimal(plan.initialCash, 'initialCash');
  if (
    plan.runId.length === 0 ||
    plan.strategyRevisionId.length === 0 ||
    plan.dataSnapshotHash.length === 0 ||
    plan.engineVersion.length === 0 ||
    plan.executionPolicyVersion.length === 0 ||
    plan.eventOrderingPolicyVersion.length === 0 ||
    plan.roundingPolicyVersion.length === 0 ||
    !Number.isInteger(plan.maxConcurrentPositions) ||
    plan.maxConcurrentPositions < 1 ||
    plan.fractionalShares !== false ||
    plan.allowShort !== false ||
    plan.allowLeverage !== false
  )
    throw new BacktestDomainError('BACKTEST_PLAN_INVALID');
  if (plan.positionSizing.type === 'fixedCash') {
    positiveDecimal(plan.positionSizing.amount, 'positionSizing.amount');
  }
  if (plan.positionSizing.type === 'fixedPercentage') {
    const percent = positiveDecimal(
      plan.positionSizing.percent,
      'positionSizing.percent',
    );
    if (percent.compare(Decimal.parse('100')) > 0) {
      throw new BacktestDomainError('BACKTEST_PLAN_INVALID', {
        field: 'positionSizing.percent',
      });
    }
  }
  validateOptionalPercent(plan.riskPolicy?.stopLossPercent, 'stopLossPercent');
  validateOptionalPercent(
    plan.riskPolicy?.takeProfitPercent,
    'takeProfitPercent',
  );
  validateOptionalPercent(
    plan.riskPolicy?.trailingStopPercent,
    'trailingStopPercent',
  );
  if (plan.riskPolicy !== undefined) {
    validateOptionalPercent(
      plan.riskPolicy.maximumPositionWeightPercent,
      'maximumPositionWeightPercent',
    );
    if (
      plan.riskPolicy.maximumHoldingBars !== undefined &&
      (!Number.isInteger(plan.riskPolicy.maximumHoldingBars) ||
        plan.riskPolicy.maximumHoldingBars < 1)
    )
      throw new BacktestDomainError('BACKTEST_PLAN_INVALID', {
        field: 'maximumHoldingBars',
      });
  }
  if (plan.liquidityPolicy?.type === 'volumeParticipation') {
    validateOptionalPercent(
      plan.liquidityPolicy.maximumParticipationPercent,
      'maximumParticipationPercent',
    );
  }
  if (plan.costPolicy?.type === 'linear') {
    const commission = nonNegativeDecimal(
      plan.costPolicy.commissionPercent,
      'commissionPercent',
    );
    const tax = nonNegativeDecimal(
      plan.costPolicy.marketTaxPercent,
      'marketTaxPercent',
    );
    const slippage = nonNegativeDecimal(
      plan.costPolicy.slippageBps,
      'slippageBps',
    );
    nonNegativeDecimal(plan.costPolicy.minimumCommission, 'minimumCommission');
    nonNegativeDecimal(plan.costPolicy.fixedFee, 'fixedFee');
    if (
      commission.compare(Decimal.parse('100')) > 0 ||
      tax.compare(Decimal.parse('100')) > 0 ||
      slippage.compare(Decimal.parse('10000')) >= 0
    )
      throw new BacktestDomainError('BACKTEST_PLAN_INVALID', {
        field: 'costPolicy',
      });
  }
}

function createFill(
  order: BacktestOrderIntent,
  requestedQuantity: Decimal,
  quantity: Decimal,
  costs: ExecutionCostCalculation,
  filledAt: string,
  reason: BacktestFill['reason'],
): BacktestFill {
  const deduplicationKey = createStableParameterHash({
    orderIntentId: order.id,
    instrumentId: order.instrumentId,
    side: order.side,
    filledAt,
    reason,
  });
  return {
    id: `fill:${deduplicationKey}`,
    deduplicationKey,
    orderIntentId: order.id,
    instrumentId: order.instrumentId,
    symbol: order.symbol,
    side: order.side,
    quantity: decimalString(quantity, 'quantity'),
    requestedQuantity: decimalString(requestedQuantity, 'requestedQuantity'),
    referencePrice: decimalString(costs.referencePrice, 'referencePrice'),
    price: decimalString(costs.fillPrice, 'price'),
    grossAmount: decimalString(costs.grossAmount, 'grossAmount'),
    slippageAmount: decimalString(costs.slippageAmount, 'slippageAmount'),
    commission: decimalString(costs.commission, 'commission'),
    fixedFee: decimalString(costs.fixedFee, 'fixedFee'),
    tax: decimalString(costs.tax, 'tax'),
    totalCosts: decimalString(costs.totalEconomicCosts, 'totalCosts'),
    netCashEffect: decimalString(
      order.side === 'BUY'
        ? costs.cashRequired.times(Decimal.parse('-1'))
        : costs.netProceeds,
      'netCashEffect',
    ),
    partial: quantity.compare(requestedQuantity) < 0,
    signalAt: order.signalAt,
    filledAt,
    reason,
  };
}

function orderIntent(
  plan: BacktestExecutionPlan,
  bar: BacktestBar,
  side: BacktestOrderIntent['side'],
  reason: BacktestOrderIntent['reason'],
): BacktestOrderIntent {
  const identity = createStableParameterHash({
    runId: plan.runId,
    eventId: bar.eventId,
    instrumentId: bar.instrumentId,
    side,
    reason,
  });
  return {
    id: `order:${identity}`,
    instrumentId: bar.instrumentId,
    symbol: bar.symbol,
    side,
    signalAt: bar.timestamp,
    signalEventId: bar.eventId,
    reason,
  };
}

function restoreHistories(
  events: readonly BacktestTimelineEvent[],
  processed: ReadonlySet<string>,
): Map<string, BacktestBar[]> {
  const histories = new Map<string, BacktestBar[]>();
  for (const event of events) {
    if (
      event.type !== 'bar' ||
      !event.isClosed ||
      !processed.has(event.eventId)
    )
      continue;
    const history = histories.get(event.instrumentId) ?? [];
    history.push(event);
    histories.set(event.instrumentId, history);
  }
  return histories;
}

function groupUnprocessedEvents(
  events: readonly BacktestTimelineEvent[],
  processed: ReadonlySet<string>,
): readonly (readonly BacktestTimelineEvent[])[] {
  const groups: BacktestTimelineEvent[][] = [];
  for (const event of events) {
    if (processed.has(event.eventId)) continue;
    const current = groups.at(-1);
    if (current?.[0]?.timestamp === event.timestamp) current.push(event);
    else groups.push([event]);
  }
  return groups;
}

function addDuplicateWarnings(
  simulation: MutableSimulation,
  events: readonly BacktestTimelineEvent[],
  duplicateIds: readonly string[],
): void {
  for (const eventId of duplicateIds) {
    if (
      simulation.warnings.some(
        (item) =>
          item.code === 'DUPLICATE_EVENT_IGNORED' && item.eventId === eventId,
      )
    )
      continue;
    const event = events.find((item) => item.eventId === eventId);
    if (event !== undefined)
      addWarning(simulation, warning('DUPLICATE_EVENT_IGNORED', event));
  }
}

function snapshotPosition(position: MutablePosition): BacktestPosition {
  return {
    instrumentId: position.instrumentId,
    symbol: position.symbol,
    quantity: decimalString(position.quantity, 'quantity'),
    averageCost: decimalString(position.averageCost, 'averageCost'),
    costBasis: decimalString(position.costBasis, 'costBasis'),
    openedAt: position.openedAt,
    entryFillId: position.entryFillId,
    highestClose: decimalString(position.highestClose, 'highestClose'),
    holdingBars: position.holdingBars,
  };
}

function optionalPrice(value: string | null, field: string): Decimal | null {
  if (value === null) return null;
  const parsed = parseLedgerDecimal(value, field, { positive: true });
  return parsed;
}

function positiveDecimal(value: string, field: string): Decimal {
  return parseLedgerDecimal(value, field, { positive: true });
}

function nonNegativeDecimal(value: string, field: string): Decimal {
  return parseLedgerDecimal(value, field, { nonNegative: true });
}

function validateOptionalPercent(
  value: string | undefined,
  field: string,
): void {
  if (value === undefined) return;
  const percent = nonNegativeDecimal(value, field);
  if (percent.isZero() || percent.compare(Decimal.parse('100')) > 0)
    throw new BacktestDomainError('BACKTEST_PLAN_INVALID', { field });
}

function applyParticipationLimit(
  plan: BacktestExecutionPlan,
  requested: Decimal,
  bar: BacktestBar,
  simulation: MutableSimulation,
): Decimal | null {
  const policy = plan.liquidityPolicy;
  if (policy === undefined || policy.type === 'unlimited') return requested;
  if (bar.volume === null) {
    addWarning(simulation, warning('LIQUIDITY_VOLUME_UNAVAILABLE', bar));
    return null;
  }
  const volume = nonNegativeDecimal(bar.volume, 'volume');
  const maximum = floorPositiveInteger(
    volume
      .times(
        nonNegativeDecimal(
          policy.maximumParticipationPercent,
          'maximumParticipationPercent',
        ),
      )
      .dividedBy(Decimal.parse('100')),
  );
  if (requested.compare(maximum) <= 0) return requested;
  if (policy.partialFillPolicy === 'reject' || maximum.isZero()) {
    addWarning(simulation, warning('PARTICIPATION_LIMIT_REJECTED', bar));
    return null;
  }
  return maximum;
}

function decimalString(value: Decimal, field: string): string {
  return value.toDatabaseString(field);
}

function floorPositiveInteger(value: Decimal): Decimal {
  const integer = value.toString().split('.')[0] ?? '0';
  return Decimal.parse(integer);
}

function maximumDecimal(
  left: Decimal | null,
  right: Decimal | null,
): Decimal | null {
  if (left === null) return right;
  if (right === null) return left;
  return left.compare(right) >= 0 ? left : right;
}

function hasPending(
  simulation: MutableSimulation,
  instrumentId: string,
  side: BacktestOrderIntent['side'],
): boolean {
  return simulation.pendingOrders.some(
    (order) => order.instrumentId === instrumentId && order.side === side,
  );
}

function hasFill(simulation: MutableSimulation, key: string): boolean {
  return simulation.fills.some((fill) => fill.deduplicationKey === key);
}

function compareOrders(
  left: BacktestOrderIntent,
  right: BacktestOrderIntent,
): number {
  const priority = (order: BacktestOrderIntent): number =>
    order.side === 'SELL' ? 3 : 6;
  return (
    priority(left) - priority(right) ||
    left.symbol.localeCompare(right.symbol) ||
    left.instrumentId.localeCompare(right.instrumentId) ||
    left.id.localeCompare(right.id)
  );
}

function compareInstrument(
  left: { readonly symbol: string; readonly instrumentId: string },
  right: { readonly symbol: string; readonly instrumentId: string },
): number {
  return (
    left.symbol.localeCompare(right.symbol) ||
    left.instrumentId.localeCompare(right.instrumentId)
  );
}

function addWarning(
  simulation: MutableSimulation,
  value: BacktestWarning,
): void {
  if (value.code === 'DUPLICATE_EVENT_IGNORED') {
    simulation.warnings.push(value);
    return;
  }
  const key = `${value.code}:${value.instrumentId}`;
  if (simulation.warningKeys.has(key)) return;
  simulation.warningKeys.add(key);
  simulation.warnings.push(value);
}

function warning(
  code: BacktestWarning['code'],
  event: Pick<BacktestTimelineEvent, 'eventId' | 'instrumentId'>,
): BacktestWarning {
  return { code, eventId: event.eventId, instrumentId: event.instrumentId };
}

function upsertCurve(
  curve: BacktestCurvePoint[],
  timestamp: string,
  value: Decimal,
): void {
  const point = { timestamp, value: decimalString(value, 'curveValue') };
  if (curve.at(-1)?.timestamp === timestamp) curve[curve.length - 1] = point;
  else curve.push(point);
}
