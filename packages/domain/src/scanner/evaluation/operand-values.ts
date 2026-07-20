import { createStableParameterHash } from '../../indicators/parameter-hash.js';
import type { ScanOperand } from '../ast/contracts.js';

import type {
  PreparedOperandValue,
  PreparedOperandValues,
} from './contracts.js';

const operandKeyCache = new WeakMap<object, string>();

export function createScanOperandKey(operand: ScanOperand): string {
  const cached = operandKeyCache.get(operand);
  if (cached !== undefined) return cached;
  let key: string;
  switch (operand.type) {
    case 'indicator':
      key = [
        'indicator',
        operand.code,
        operand.version,
        operand.output ?? '',
        operand.timeframe,
        createStableParameterHash(operand.parameters),
      ].join(':');
      break;
    case 'priceField':
      key = `priceField:${operand.field}:${operand.timeframe}`;
      break;
    case 'volumeField':
      key = `volumeField:${operand.field}:${operand.timeframe}`;
      break;
    case 'marketField':
      key = `marketField:${operand.field}`;
      break;
    case 'constantNumber':
      key = `constantNumber:${Object.is(operand.value, -0) ? 0 : operand.value}`;
      break;
    case 'constantBoolean':
      key = `constantBoolean:${operand.value}`;
      break;
  }
  operandKeyCache.set(operand, key);
  return key;
}

export function createPreparedOperandValues(
  entries: readonly (readonly [ScanOperand, PreparedOperandValue])[],
): PreparedOperandValues {
  return new Map(
    entries.map(([operand, value]) => [createScanOperandKey(operand), value]),
  );
}
