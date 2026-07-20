import { createStableParameterHash } from '../indicators/parameter-hash.js';
import type { BacktestRunApplicationService } from './backtest-run-application-service.js';
import type {
  StrategyParameterDefinition,
  StrategyParameterValue,
} from '../strategies/contracts.js';
import type {
  CreateBacktestRunRequest,
  ExperimentChildBinding,
  ExperimentChildRunPort,
  ExperimentCombination,
  ExperimentDefinitionInput,
  ExperimentGridAxis,
  ExperimentRuntimeRecord,
  ExperimentRuntimeRepository,
  ExperimentRunCompatibilityKey,
  ExperimentSampleRange,
} from './runtime-contracts.js';
import { BacktestRuntimeApplicationError } from './runtime-errors.js';

export function generateExperimentCombinations(
  input: ExperimentDefinitionInput,
): readonly ExperimentCombination[] {
  if (
    !Number.isInteger(input.grid.maximumCombinations) ||
    input.grid.maximumCombinations < 1 ||
    input.grid.axes.length === 0
  )
    throw new BacktestRuntimeApplicationError('EXPERIMENT_GRID_INVALID');
  validateSamples(input.grid.samples);
  const definitions = new Map(
    input.parameterDefinitions.map((definition) => [
      definition.name,
      definition,
    ]),
  );
  const axes = [...input.grid.axes]
    .sort((left, right) => left.parameter.localeCompare(right.parameter))
    .map((axis) => ({
      parameter: axis.parameter,
      values: resolveAxisValues(axis, definitions.get(axis.parameter)),
    }));
  if (new Set(axes.map((axis) => axis.parameter)).size !== axes.length)
    throw new BacktestRuntimeApplicationError('EXPERIMENT_DUPLICATE_BINDING');
  const count = axes.reduce((total, axis) => total * axis.values.length, 1);
  if (count > input.grid.maximumCombinations)
    throw new BacktestRuntimeApplicationError(
      'EXPERIMENT_COMBINATION_LIMIT_EXCEEDED',
      { count, maximum: input.grid.maximumCombinations },
    );

  const combinations: ExperimentCombination[] = [];
  const visit = (
    axisIndex: number,
    values: Record<string, StrategyParameterValue>,
  ): void => {
    const axis = axes[axisIndex];
    if (axis === undefined) {
      const normalized = Object.fromEntries(
        Object.entries(values).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      );
      combinations.push({
        index: combinations.length,
        values: normalized,
        bindingHash: createStableParameterHash(normalized),
      });
      return;
    }
    for (const value of axis.values) {
      visit(axisIndex + 1, { ...values, [axis.parameter]: value });
    }
  };
  visit(0, {});
  if (
    new Set(combinations.map((combination) => combination.bindingHash)).size !==
    combinations.length
  )
    throw new BacktestRuntimeApplicationError('EXPERIMENT_DUPLICATE_BINDING');
  return combinations;
}

export function createExperimentChildBindings(
  combinations: readonly ExperimentCombination[],
  samples: readonly ExperimentSampleRange[],
): readonly ExperimentChildBinding[] {
  validateSamples(samples);
  const orderedSamples = [...samples].sort(
    (left, right) => samplePriority(left.role) - samplePriority(right.role),
  );
  const children: ExperimentChildBinding[] = [];
  for (const combination of combinations) {
    for (const sample of orderedSamples) {
      children.push({
        combinationIndex: children.length,
        sampleRole: sample.role,
        rangeFrom: sample.from,
        rangeTo: sample.to,
        values: combination.values,
        bindingHash: createStableParameterHash({
          parameterBindingHash: combination.bindingHash,
          sampleRole: sample.role,
          rangeFrom: sample.from,
          rangeTo: sample.to,
        }),
      });
    }
  }
  return children;
}

export interface ExperimentOrchestrationInput {
  readonly experiment: ExperimentRuntimeRecord;
  readonly definition: ExperimentDefinitionInput;
  readonly engineVersion: string;
  readonly executionPolicyVersion: string;
  readonly costPolicyVersion: string;
  readonly eventOrderingPolicyVersion: string;
}

export class ResearchExperimentRuntimeService {
  constructor(
    private readonly repository: ExperimentRuntimeRepository,
    private readonly childRuns: ExperimentChildRunPort,
  ) {}

  async orchestrate(input: ExperimentOrchestrationInput): Promise<{
    readonly status: 'completed' | 'partial' | 'cancelled';
    readonly createdCount: number;
    readonly reusedCount: number;
    readonly failedCount: number;
  }> {
    const combinations = generateExperimentCombinations(input.definition);
    const children = createExperimentChildBindings(
      combinations,
      input.definition.grid.samples,
    );
    let createdCount = 0;
    let reusedCount = 0;
    let failedCount = 0;
    for (const child of children) {
      if (await this.repository.isCancellationRequested(input.experiment.id)) {
        await this.cancelRunning(input.experiment);
        await this.repository.completeExperiment({
          experimentId: input.experiment.id,
          status: 'cancelled',
          completedCount: createdCount + reusedCount,
          failedCount,
          reusedCount,
          warnings: overfittingWarnings({
            combinationCount: combinations.length,
          }),
        });
        return { status: 'cancelled', createdCount, reusedCount, failedCount };
      }
      const compatibility = compatibilityKey(input, child);
      const reusable =
        await this.repository.findReusableCompletedRun(compatibility);
      if (reusable !== null) {
        const attached = await this.repository.attachChild({
          experimentId: input.experiment.id,
          ownerUserId: input.experiment.ownerUserId,
          child,
          runId: reusable.runId,
          status: 'reused',
        });
        if (attached === 'created') reusedCount += 1;
        continue;
      }
      try {
        const run = await this.childRuns.create({
          experiment: input.experiment,
          child,
        });
        const attached = await this.repository.attachChild({
          experimentId: input.experiment.id,
          ownerUserId: input.experiment.ownerUserId,
          child,
          runId: run.runId,
          status: 'queued',
        });
        if (attached === 'created') createdCount += 1;
      } catch (error: unknown) {
        failedCount += 1;
        await this.repository.markChildFailed({
          experimentId: input.experiment.id,
          child,
          errorCode:
            error instanceof BacktestRuntimeApplicationError
              ? error.code
              : 'EXPERIMENT_CHILD_RUN_FAILED',
        });
      }
    }
    const status = failedCount > 0 ? 'partial' : 'completed';
    await this.repository.completeExperiment({
      experimentId: input.experiment.id,
      status,
      completedCount: createdCount + reusedCount,
      failedCount,
      reusedCount,
      warnings: overfittingWarnings({
        combinationCount: combinations.length,
      }),
    });
    return { status, createdCount, reusedCount, failedCount };
  }

  async cancel(experiment: ExperimentRuntimeRecord): Promise<void> {
    await this.cancelRunning(experiment);
    await this.repository.completeExperiment({
      experimentId: experiment.id,
      status: 'cancelled',
      completedCount: 0,
      failedCount: 0,
      reusedCount: 0,
      warnings: [],
    });
  }

  private async cancelRunning(
    experiment: ExperimentRuntimeRecord,
  ): Promise<void> {
    const runIds = await this.repository.listRunningChildRunIds(experiment.id);
    for (const runId of [...runIds].sort()) {
      await this.childRuns.requestCancellation(runId, experiment.ownerUserId);
    }
  }
}

export interface ExperimentChildRunRequestFactory {
  create(input: {
    readonly experiment: ExperimentRuntimeRecord;
    readonly child: ExperimentChildBinding;
  }): Omit<
    CreateBacktestRunRequest,
    | 'userId'
    | 'idempotencyKey'
    | 'strategyId'
    | 'strategyRevision'
    | 'rangeFrom'
    | 'rangeTo'
    | 'experimentBinding'
  >;
}

export class ApplicationExperimentChildRunPort implements ExperimentChildRunPort {
  constructor(
    private readonly runs: BacktestRunApplicationService,
    private readonly requestFactory: ExperimentChildRunRequestFactory,
  ) {}

  async create(input: {
    readonly experiment: ExperimentRuntimeRecord;
    readonly child: ExperimentChildBinding;
  }): Promise<{ readonly runId: string }> {
    const request = this.requestFactory.create(input);
    const created = await this.runs.create({
      ...request,
      userId: input.experiment.ownerUserId,
      idempotencyKey: `experiment:${input.experiment.id}:${input.child.bindingHash}`,
      strategyId: input.experiment.strategyId,
      strategyRevision: input.experiment.strategyRevision,
      dataSnapshotHash: input.experiment.dataSnapshotHash,
      rangeFrom: input.child.rangeFrom,
      rangeTo: input.child.rangeTo,
      experimentBinding: {
        hash: input.child.bindingHash,
        sampleRole: input.child.sampleRole,
        values: input.child.values,
      },
    });
    return { runId: created.run.id };
  }

  async requestCancellation(runId: string, userId: string): Promise<void> {
    await this.runs.requestCancellation(runId, userId);
  }
}

export interface ExperimentMetricRow {
  readonly bindingHash: string;
  readonly sampleRole: 'train' | 'validation' | 'test' | 'holdout';
  readonly totalReturnPercent: string;
  readonly maximumDrawdownPercent: string;
  readonly tradeCount: number;
  readonly totalCosts: string;
}

export function aggregateExperimentResults(
  rows: readonly ExperimentMetricRow[],
): readonly (ExperimentMetricRow & { readonly rank: number })[] {
  return [...rows]
    .sort(
      (left, right) =>
        Number(right.totalReturnPercent) - Number(left.totalReturnPercent) ||
        Number(left.maximumDrawdownPercent) -
          Number(right.maximumDrawdownPercent) ||
        left.bindingHash.localeCompare(right.bindingHash),
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function overfittingWarnings(input: {
  readonly combinationCount: number;
  readonly bestInSampleReturn?: number | undefined;
  readonly medianInSampleReturn?: number | undefined;
  readonly outOfSampleReturn?: number | undefined;
  readonly tradeCount?: number | undefined;
  readonly costSensitivityPercent?: number | undefined;
  readonly neighborhoodInstabilityPercent?: number | undefined;
}): readonly string[] {
  const warnings: string[] = [];
  if (input.combinationCount >= 50) warnings.push('HIGH_COMBINATION_COUNT');
  if (
    input.bestInSampleReturn !== undefined &&
    input.medianInSampleReturn !== undefined &&
    input.bestInSampleReturn - input.medianInSampleReturn >= 20
  )
    warnings.push('BEST_MEDIAN_GAP');
  if (
    input.bestInSampleReturn !== undefined &&
    input.outOfSampleReturn !== undefined &&
    input.bestInSampleReturn - input.outOfSampleReturn >= 20
  )
    warnings.push('OUT_OF_SAMPLE_DEGRADATION');
  if (input.tradeCount !== undefined && input.tradeCount < 10)
    warnings.push('LOW_TRADE_COUNT');
  if (
    input.costSensitivityPercent !== undefined &&
    input.costSensitivityPercent >= 20
  )
    warnings.push('HIGH_COST_SENSITIVITY');
  if (
    input.neighborhoodInstabilityPercent !== undefined &&
    input.neighborhoodInstabilityPercent >= 20
  )
    warnings.push('PARAMETER_NEIGHBORHOOD_INSTABILITY');
  return warnings;
}

function compatibilityKey(
  input: ExperimentOrchestrationInput,
  child: ExperimentChildBinding,
): ExperimentRunCompatibilityKey {
  return {
    ownerUserId: input.experiment.ownerUserId,
    strategyId: input.experiment.strategyId,
    strategyRevision: input.experiment.strategyRevision,
    bindingHash: child.bindingHash,
    dataSnapshotHash: input.experiment.dataSnapshotHash,
    engineVersion: input.engineVersion,
    executionPolicyVersion: input.executionPolicyVersion,
    costPolicyVersion: input.costPolicyVersion,
    eventOrderingPolicyVersion: input.eventOrderingPolicyVersion,
    rangeFrom: child.rangeFrom,
    rangeTo: child.rangeTo,
  };
}

function resolveAxisValues(
  axis: ExperimentGridAxis,
  definition: StrategyParameterDefinition | undefined,
): readonly StrategyParameterValue[] {
  if (definition === undefined)
    throw new BacktestRuntimeApplicationError('EXPERIMENT_PARAMETER_INVALID', {
      parameter: axis.parameter,
    });
  const values =
    'values' in axis ? [...axis.values] : expandNumericRange(axis.range);
  if (values.length === 0)
    throw new BacktestRuntimeApplicationError('EXPERIMENT_GRID_INVALID');
  const normalized = values.map((value) => validateValue(definition, value));
  normalized.sort(compareParameterValues);
  if (new Set(normalized.map(canonicalValue)).size !== normalized.length)
    throw new BacktestRuntimeApplicationError('EXPERIMENT_DUPLICATE_BINDING', {
      parameter: axis.parameter,
    });
  return normalized;
}

function expandNumericRange(range: {
  readonly from: number;
  readonly to: number;
  readonly step: number;
}): readonly number[] {
  if (
    !Number.isFinite(range.from) ||
    !Number.isFinite(range.to) ||
    !Number.isFinite(range.step) ||
    range.step <= 0 ||
    range.to < range.from
  )
    throw new BacktestRuntimeApplicationError('EXPERIMENT_GRID_INVALID');
  const scale =
    10 **
    Math.max(
      decimalPlaces(range.from),
      decimalPlaces(range.to),
      decimalPlaces(range.step),
    );
  const from = Math.round(range.from * scale);
  const to = Math.round(range.to * scale);
  const step = Math.round(range.step * scale);
  if (![from, to, step].every(Number.isSafeInteger) || step <= 0)
    throw new BacktestRuntimeApplicationError('EXPERIMENT_GRID_INVALID');
  const values: number[] = [];
  for (let value = from; value <= to; value += step) {
    values.push(value / scale);
    if (values.length > 10_000)
      throw new BacktestRuntimeApplicationError(
        'EXPERIMENT_COMBINATION_LIMIT_EXCEEDED',
      );
  }
  return values;
}

function validateValue(
  definition: StrategyParameterDefinition,
  value: StrategyParameterValue,
): StrategyParameterValue {
  if (definition.type === 'boolean') {
    if (typeof value !== 'boolean') invalidParameter(definition.name);
    return value;
  }
  if (definition.type === 'enum') {
    if (typeof value !== 'string' || !definition.values.includes(value))
      invalidParameter(definition.name);
    return value;
  }
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (definition.type === 'integer' && !Number.isInteger(value)) ||
    value < definition.minimum ||
    value > definition.maximum
  )
    invalidParameter(definition.name);
  return value;
}

function invalidParameter(name: string): never {
  throw new BacktestRuntimeApplicationError('EXPERIMENT_PARAMETER_INVALID', {
    parameter: name,
  });
}

function validateSamples(samples: readonly ExperimentSampleRange[]): void {
  if (samples.length === 0)
    throw new BacktestRuntimeApplicationError('EXPERIMENT_GRID_INVALID');
  const roles = new Set<string>();
  for (const sample of samples) {
    if (
      roles.has(sample.role) ||
      !validIso(sample.from) ||
      !validIso(sample.to) ||
      Date.parse(sample.to) < Date.parse(sample.from)
    )
      throw new BacktestRuntimeApplicationError('EXPERIMENT_GRID_INVALID');
    roles.add(sample.role);
  }
  const ordered = [...samples].sort(
    (left, right) => Date.parse(left.from) - Date.parse(right.from),
  );
  for (let index = 1; index < ordered.length; index += 1) {
    if (Date.parse(ordered[index]!.from) <= Date.parse(ordered[index - 1]!.to))
      throw new BacktestRuntimeApplicationError('EXPERIMENT_HOLDOUT_OVERLAP');
  }
}

function compareParameterValues(
  left: StrategyParameterValue,
  right: StrategyParameterValue,
): number {
  if (typeof left === 'number' && typeof right === 'number')
    return left - right;
  return canonicalValue(left).localeCompare(canonicalValue(right));
}

function canonicalValue(value: StrategyParameterValue): string {
  return `${typeof value}:${String(value)}`;
}

function decimalPlaces(value: number): number {
  const text = String(value);
  if (text.includes('e-')) return Number(text.split('e-')[1] ?? '0');
  return text.split('.')[1]?.length ?? 0;
}

function validIso(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function samplePriority(role: ExperimentSampleRange['role']): number {
  return { train: 1, validation: 2, test: 3, holdout: 4 }[role];
}
