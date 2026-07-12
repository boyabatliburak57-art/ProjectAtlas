import type { ScanOperator } from '../ast/contracts.js';
import type {
  PreparedNumberValue,
  ResolvedConditionOperands,
  ScanOperatorEvaluation,
  ScanOperatorEvaluationInput,
  ScanOperatorEvaluator,
} from '../evaluation/contracts.js';

interface ResolvedNumbers {
  readonly values: readonly PreparedNumberValue[];
}

interface ResolvedCurrentNumbers {
  readonly values: readonly number[];
}

const matched: ScanOperatorEvaluation = { status: 'matched' };
const notMatched: ScanOperatorEvaluation = { status: 'notMatched' };

function result(value: boolean): ScanOperatorEvaluation {
  return value ? matched : notMatched;
}

function unavailable(
  reason: ScanOperatorEvaluation['reason'],
): ScanOperatorEvaluation {
  return { status: 'notEvaluable', reason };
}

function numbers(
  operands: ResolvedConditionOperands,
  arity: 1 | 2 | 3,
): ResolvedNumbers | ScanOperatorEvaluation {
  const values = [operands.left, operands.right, operands.upperBound].slice(
    0,
    arity,
  );
  if (values.some((value) => value?.type !== 'number')) {
    return unavailable('OPERAND_TYPE_MISMATCH');
  }
  const numeric = values as PreparedNumberValue[];
  if (
    numeric.some(
      (value) => value.current === null || !Number.isFinite(value.current),
    )
  ) {
    return unavailable('OPERAND_UNAVAILABLE');
  }
  return { values: numeric };
}

function currentNumbers(
  operands: ResolvedConditionOperands,
  arity: 1 | 2 | 3,
): ResolvedCurrentNumbers | ScanOperatorEvaluation {
  const resolved = numbers(operands, arity);
  if ('status' in resolved) return resolved;
  return { values: resolved.values.map((value) => value.current as number) };
}

function binary(
  compare: (left: number, right: number) => boolean,
): ScanOperatorEvaluator {
  return ({ operands }) => {
    const values = currentNumbers(operands, 2);
    return 'status' in values
      ? values
      : result(compare(values.values[0]!, values.values[1]!));
  };
}

function range(
  compare: (value: number, lower: number, upper: number) => boolean,
): ScanOperatorEvaluator {
  return ({ operands }) => {
    const values = currentNumbers(operands, 3);
    return 'status' in values
      ? values
      : result(
          compare(values.values[0]!, values.values[1]!, values.values[2]!),
        );
  };
}

function cross(direction: 'above' | 'below'): ScanOperatorEvaluator {
  return ({ operands }) => {
    const values = numbers(operands, 2);
    if ('status' in values) return values;
    const [left, right] = values.values;
    if (
      left?.previous === null ||
      left?.previous === undefined ||
      right?.previous === null ||
      right?.previous === undefined ||
      !Number.isFinite(left.previous) ||
      !Number.isFinite(right.previous)
    ) {
      return unavailable('PREVIOUS_VALUE_UNAVAILABLE');
    }
    return direction === 'above'
      ? result(
          left.previous <= right.previous && left.current! > right.current!,
        )
      : result(
          left.previous >= right.previous && left.current! < right.current!,
        );
  };
}

function boolean(expected: boolean): ScanOperatorEvaluator {
  return ({ operands }) => {
    const value = operands.left;
    if (value.type !== 'boolean') return unavailable('OPERAND_TYPE_MISMATCH');
    return value.current === null
      ? unavailable('OPERAND_UNAVAILABLE')
      : result(value.current === expected);
  };
}

const evaluators = new Map<ScanOperator, ScanOperatorEvaluator>([
  ['EQ', binary((left, right) => left === right)],
  ['NE', binary((left, right) => left !== right)],
  ['GT', binary((left, right) => left > right)],
  ['GTE', binary((left, right) => left >= right)],
  ['LT', binary((left, right) => left < right)],
  ['LTE', binary((left, right) => left <= right)],
  ['BETWEEN', range((value, lower, upper) => value >= lower && value <= upper)],
  ['OUTSIDE', range((value, lower, upper) => value < lower || value > upper)],
  ['CROSSES_ABOVE', cross('above')],
  ['CROSSES_BELOW', cross('below')],
  ['IS_TRUE', boolean(true)],
  ['IS_FALSE', boolean(false)],
  [
    'WITHIN_PERCENT_OF',
    ({ operands, percent }: ScanOperatorEvaluationInput) => {
      const values = currentNumbers(operands, 2);
      if ('status' in values) return values;
      if (percent === undefined || !Number.isFinite(percent) || percent < 0) {
        return unavailable('OPERAND_UNAVAILABLE');
      }
      const left = values.values[0]!;
      const reference = values.values[1]!;
      if (reference === 0) {
        return left === 0 ? matched : unavailable('ZERO_DENOMINATOR');
      }
      return result(
        (Math.abs(left - reference) / Math.abs(reference)) * 100 <= percent,
      );
    },
  ],
]);

export function evaluateScanOperator(
  operator: ScanOperator,
  input: ScanOperatorEvaluationInput,
): ScanOperatorEvaluation {
  return (
    evaluators.get(operator)?.(input) ?? unavailable('OPERATOR_NOT_IMPLEMENTED')
  );
}

export const EVALUATED_SCAN_OPERATORS = Object.freeze([...evaluators.keys()]);
