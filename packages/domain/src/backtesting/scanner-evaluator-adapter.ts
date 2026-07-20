import type { ScanOperand, ScanRuleAst } from '../scanner/ast/contracts.js';
import {
  evaluateScanRule,
  type PreparedOperandValue,
  type ScanRuleEvaluation,
} from '../scanner/evaluation/index.js';
import { createScanOperandKey } from '../scanner/evaluation/operand-values.js';
import type {
  BacktestBar,
  BacktestSignalContext,
  BacktestSignalEvaluator,
} from './contracts.js';

export interface BacktestOperandValueResolver {
  resolve(
    operand: ScanOperand,
    context: BacktestSignalContext,
  ): PreparedOperandValue | undefined;
}

export class ScannerBacktestSignalEvaluator implements BacktestSignalEvaluator {
  private readonly validatedBarLengths = new WeakMap<
    readonly BacktestBar[],
    number
  >();
  private readonly operandsByRule = new WeakMap<
    ScanRuleAst,
    readonly ScanOperand[]
  >();
  private readonly operandKeys = new WeakMap<object, string>();

  constructor(private readonly resolver?: BacktestOperandValueResolver) {}

  evaluate(
    rule: ScanRuleAst,
    context: BacktestSignalContext,
  ): ScanRuleEvaluation {
    assertNoFutureOrOpenBars(context, this.validatedBarLengths);
    const values = new Map<string, PreparedOperandValue>();
    const operands = this.operandsByRule.get(rule) ?? collectOperands(rule);
    this.operandsByRule.set(rule, operands);
    for (const operand of operands) {
      const resolved =
        resolveBarOperand(operand, context.bars) ??
        this.resolver?.resolve(operand, context);
      if (resolved !== undefined)
        values.set(this.operandKey(operand), resolved);
    }
    return evaluateScanRule(rule, values);
  }

  private operandKey(operand: ScanOperand): string {
    if (typeof operand !== 'object' || operand === null)
      return createScanOperandKey(operand);
    const cached = this.operandKeys.get(operand);
    if (cached !== undefined) return cached;
    const key = createScanOperandKey(operand);
    this.operandKeys.set(operand, key);
    return key;
  }
}

function resolveBarOperand(
  operand: ScanOperand,
  bars: readonly BacktestBar[],
): PreparedOperandValue | undefined {
  if (operand.type !== 'priceField' && operand.type !== 'volumeField') {
    return undefined;
  }
  const field = operand.type === 'volumeField' ? 'volume' : operand.field;
  const current = bars.at(-1);
  const previous = bars.at(-2);
  return {
    type: 'number',
    current: finiteNumber(current?.[field] ?? null),
    previous: finiteNumber(previous?.[field] ?? null),
  };
}

function finiteNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function collectOperands(rule: ScanRuleAst): readonly ScanOperand[] {
  const operands = new Map<string, ScanOperand>();
  const visit = (node: ScanRuleAst['root']['children'][number]): void => {
    if (node.type === 'group') {
      node.children.forEach(visit);
      return;
    }
    [node.left, node.right, node.upperBound].forEach((operand) => {
      if (operand !== undefined)
        operands.set(createScanOperandKey(operand), operand);
    });
  };
  rule.root.children.forEach(visit);
  return [...operands.values()];
}

function assertNoFutureOrOpenBars(
  context: BacktestSignalContext,
  validatedBarLengths: WeakMap<readonly BacktestBar[], number>,
): void {
  const latest = context.bars.at(-1);
  if (latest !== undefined && latest.timestamp > context.signalAt)
    throw new Error('BACKTEST_SIGNAL_CONTEXT_LOOKAHEAD');
  const cachedLength = validatedBarLengths.get(context.bars) ?? 0;
  const start = cachedLength <= context.bars.length ? cachedLength : 0;
  for (let index = start; index < context.bars.length; index += 1) {
    const bar = context.bars[index]!;
    const previous = context.bars[index - 1];
    if (
      !bar.isClosed ||
      bar.timestamp > context.signalAt ||
      (previous !== undefined && previous.timestamp > bar.timestamp)
    ) {
      throw new Error('BACKTEST_SIGNAL_CONTEXT_LOOKAHEAD');
    }
  }
  validatedBarLengths.set(context.bars, context.bars.length);
}
