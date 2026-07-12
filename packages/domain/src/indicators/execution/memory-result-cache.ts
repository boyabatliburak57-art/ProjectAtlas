import type {
  IndicatorCalculationResult,
  IndicatorOutput,
} from '../contracts.js';
import type { IndicatorResultCache } from './contracts.js';

export class MemoryIndicatorResultCache implements IndicatorResultCache {
  private readonly entries = new Map<string, IndicatorCalculationResult>();

  get size(): number {
    return this.entries.size;
  }

  get(key: string): Promise<IndicatorCalculationResult | null> {
    const value = this.entries.get(key);
    return Promise.resolve(value === undefined ? null : cloneResult(value));
  }

  set(key: string, value: IndicatorCalculationResult): Promise<void> {
    this.entries.set(key, cloneResult(value));
    return Promise.resolve();
  }

  clear(): void {
    this.entries.clear();
  }
}

function cloneResult(
  value: IndicatorCalculationResult,
): IndicatorCalculationResult {
  return {
    metadata: {
      ...value.metadata,
      dataCutoffAt: new Date(value.metadata.dataCutoffAt),
      calculatedAt: new Date(value.metadata.calculatedAt),
    },
    output: cloneOutput(value.output),
  };
}

function cloneOutput(output: IndicatorOutput): IndicatorOutput {
  if (output.kind === 'scalar') {
    return { kind: 'scalar', values: [...output.values] };
  }
  return {
    kind: 'multi',
    outputs: Object.fromEntries(
      Object.entries(output.outputs).map(([key, values]) => [key, [...values]]),
    ),
  };
}
