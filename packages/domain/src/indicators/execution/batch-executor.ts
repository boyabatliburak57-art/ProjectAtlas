import type {
  IndicatorCalculationResult,
  IndicatorInput,
  WarmupRequirement,
} from '../contracts.js';
import { IndicatorDomainError } from '../errors.js';
import { createStableParameterHash } from '../parameter-hash.js';
import type {
  IndicatorRegistry,
  ResolvedIndicatorDefinition,
} from '../registry/index.js';
import {
  validateIndicatorInput,
  validateIndicatorOutput,
} from '../validation.js';
import type {
  BatchExecutionReport,
  BatchExecutorDependencies,
  BatchIndicatorFailure,
  BatchIndicatorRequest,
  BatchIndicatorResult,
  BatchIndicatorSuccess,
} from './contracts.js';

interface PreparedRequest {
  readonly request: BatchIndicatorRequest;
  readonly definition: ResolvedIndicatorDefinition;
  readonly parameters: unknown;
  readonly parameterHash: string;
  readonly cacheKey: string;
  readonly warmup: WarmupRequirement;
}

interface PreparedGroup {
  readonly prepared: PreparedRequest;
  readonly indexes: number[];
  readonly requestIds: string[];
}

interface MutableWarmup {
  minimumInputBars: number;
  recommendedWarmupBars: number;
  firstValidIndex: number;
}

export class IndicatorBatchExecutor {
  constructor(
    private readonly registry: IndicatorRegistry,
    private readonly dependencies: BatchExecutorDependencies,
  ) {}

  async execute(
    requests: readonly BatchIndicatorRequest[],
  ): Promise<BatchExecutionReport> {
    this.dependencies.metrics.increment(
      'indicator.batch.requests',
      requests.length,
    );
    const results: (BatchIndicatorResult | undefined)[] = Array.from({
      length: requests.length,
    });
    const groups = new Map<string, PreparedGroup>();
    const warmup = emptyWarmup();

    requests.forEach((request, index) => {
      try {
        const prepared = this.prepare(request);
        aggregateWarmup(warmup, prepared.warmup);
        const group = groups.get(prepared.cacheKey);
        if (group === undefined) {
          groups.set(prepared.cacheKey, {
            prepared,
            indexes: [index],
            requestIds: [request.requestId],
          });
        } else {
          group.indexes.push(index);
          group.requestIds.push(request.requestId);
          this.dependencies.metrics.increment('indicator.batch.deduplicated');
        }
      } catch (error: unknown) {
        results[index] = failure(request.requestId, error);
        this.dependencies.metrics.increment('indicator.batch.failure');
      }
    });

    for (const group of groups.values()) {
      await this.executeGroup(group, results);
    }

    return {
      warmup,
      results: results.map((result) => {
        if (result === undefined) {
          throw new Error('Batch result invariant was violated');
        }
        return result;
      }),
    };
  }

  private prepare(request: BatchIndicatorRequest): PreparedRequest {
    const definition = this.registry.resolve(
      request.indicatorCode,
      request.indicatorVersion,
    );
    const parameters = definition.parseParameters(request.parameters);
    const warmup = definition.getWarmup(parameters);
    validateIndicatorInput(
      request.input,
      definition.catalog.requiredInputFields,
      warmup,
    );
    const parameterHash = createStableParameterHash(parameters);
    return {
      request,
      definition,
      parameters,
      parameterHash,
      warmup,
      cacheKey: createIndicatorCacheKey(request, parameterHash),
    };
  }

  private async executeGroup(
    group: PreparedGroup,
    results: (BatchIndicatorResult | undefined)[],
  ): Promise<void> {
    const { prepared, indexes, requestIds } = group;
    try {
      let cached = await this.dependencies.cache.get(prepared.cacheKey);
      const cacheHit = cached !== null;
      this.dependencies.metrics.increment(
        cacheHit ? 'indicator.cache.hit' : 'indicator.cache.miss',
      );
      if (cached === null) {
        cached = this.calculate(prepared);
        await this.dependencies.cache.set(prepared.cacheKey, cached);
        this.dependencies.metrics.increment(
          'indicator.calculation.completed',
          1,
          {
            code: prepared.request.indicatorCode,
            version: String(prepared.request.indicatorVersion),
          },
        );
      }

      indexes.forEach((index, duplicateIndex) => {
        results[index] = success(
          requestIds[duplicateIndex] ?? prepared.request.requestId,
          cached,
          cacheHit,
          duplicateIndex > 0,
        );
      });
    } catch (error: unknown) {
      indexes.forEach((index, requestIndex) => {
        results[index] = failure(
          requestIds[requestIndex] ?? prepared.request.requestId,
          error,
        );
      });
      this.dependencies.metrics.increment(
        'indicator.batch.failure',
        indexes.length,
      );
    }
  }

  private calculate(prepared: PreparedRequest): IndicatorCalculationResult {
    let output: unknown;
    try {
      output = prepared.definition.calculate(
        prepared.request.input,
        prepared.parameters,
      );
    } catch (error: unknown) {
      if (error instanceof IndicatorDomainError) throw error;
      throw new IndicatorDomainError('INDICATOR_CALCULATION_FAILED', {
        cause: error,
      });
    }
    const parsedOutput = prepared.definition.parseOutput(output);
    validateIndicatorOutput(
      parsedOutput,
      prepared.request.input.bars.length,
      prepared.warmup,
      prepared.definition.catalog.outputSpecification,
    );
    return {
      output: parsedOutput,
      metadata: {
        indicatorCode: prepared.request.indicatorCode,
        indicatorVersion: prepared.request.indicatorVersion,
        parameterHash: prepared.parameterHash,
        instrumentId: prepared.request.input.instrumentId,
        timeframe: prepared.request.input.timeframe,
        adjustmentMode: prepared.request.input.adjustmentMode,
        dataCutoffAt: new Date(prepared.request.input.dataCutoffAt),
        closedBarPolicy: prepared.request.closedBarPolicy,
        calculatedAt: this.dependencies.now?.() ?? new Date(),
        firstValidIndex: prepared.warmup.firstValidIndex,
      },
    };
  }
}

export function createIndicatorCacheKey(
  request: BatchIndicatorRequest,
  parameterHash = createStableParameterHash(request.parameters),
): string {
  return `indicator:${createStableParameterHash({
    code: request.indicatorCode,
    version: request.indicatorVersion,
    parameterHash,
    instrumentId: request.input.instrumentId,
    timeframe: request.input.timeframe,
    adjustmentMode: request.input.adjustmentMode,
    dataCutoffAt: request.input.dataCutoffAt.toISOString(),
    closedBarPolicy: request.closedBarPolicy,
    dataHash: inputFingerprint(request.input),
  })}`;
}

function inputFingerprint(input: IndicatorInput): string {
  return createStableParameterHash(
    input.bars.map((bar) => ({
      timestamp: bar.timestamp.toISOString(),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      isClosed: bar.isClosed,
    })),
  );
}

function emptyWarmup(): MutableWarmup {
  return { minimumInputBars: 0, recommendedWarmupBars: 0, firstValidIndex: 0 };
}

function aggregateWarmup(
  target: MutableWarmup,
  value: WarmupRequirement,
): void {
  target.minimumInputBars = Math.max(
    target.minimumInputBars,
    value.minimumInputBars,
  );
  target.recommendedWarmupBars = Math.max(
    target.recommendedWarmupBars,
    value.recommendedWarmupBars,
  );
  target.firstValidIndex = Math.max(
    target.firstValidIndex,
    value.firstValidIndex,
  );
}

function success(
  requestId: string,
  result: IndicatorCalculationResult,
  cacheHit: boolean,
  deduplicated: boolean,
): BatchIndicatorSuccess {
  return { status: 'success', requestId, result, cacheHit, deduplicated };
}

function failure(requestId: string, error: unknown): BatchIndicatorFailure {
  const normalized =
    error instanceof IndicatorDomainError
      ? error
      : new IndicatorDomainError('INDICATOR_CALCULATION_FAILED');
  return {
    status: 'failure',
    requestId,
    error: { code: normalized.code, message: normalized.message },
  };
}
