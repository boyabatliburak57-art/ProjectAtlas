import { createStableParameterHash } from '../../indicators/parameter-hash.js';
import type { ScanOperand } from '../ast/contracts.js';

import type {
  PreparedOperandValue,
  PreparedOperandValues,
} from './contracts.js';

export function createScanOperandKey(operand: ScanOperand): string {
  switch (operand.type) {
    case 'indicator':
      return [
        'indicator',
        operand.code,
        operand.version,
        operand.output ?? '',
        operand.timeframe,
        createStableParameterHash(operand.parameters),
      ].join(':');
    case 'priceField':
      return `priceField:${operand.field}:${operand.timeframe}`;
    case 'volumeField':
      return `volumeField:${operand.field}:${operand.timeframe}`;
    case 'marketField':
      return `marketField:${operand.field}`;
    case 'constantNumber':
      return `constantNumber:${Object.is(operand.value, -0) ? 0 : operand.value}`;
    case 'constantBoolean':
      return `constantBoolean:${operand.value}`;
  }
}

export function createPreparedOperandValues(
  entries: readonly (readonly [ScanOperand, PreparedOperandValue])[],
): PreparedOperandValues {
  return new Map(
    entries.map(([operand, value]) => [createScanOperandKey(operand), value]),
  );
}
