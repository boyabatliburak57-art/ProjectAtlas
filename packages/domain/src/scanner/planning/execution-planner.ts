import type {
  IndicatorInputField,
  IndicatorTimeframe,
  WarmupRequirement,
} from '../../indicators/contracts.js';
import { createStableParameterHash } from '../../indicators/parameter-hash.js';
import type { ResolvedIndicatorDefinition } from '../../indicators/registry/indicator-registry.js';
import type {
  IndicatorOperand,
  ScanConditionNode,
  ScanOperand,
  ScanRuleNode,
} from '../ast/contracts.js';
import {
  conditionOperands,
  resolveScanOperator,
} from '../operators/operator-registry.js';
import { validateScanRule } from '../validation/scan-rule-validator.js';

import type {
  PlannedIndicatorRequest,
  ScanComplexity,
  ScanDataRequirement,
  ScanExecutionPlan,
  ScanPlannerDependencies,
  ScanPlanningRequest,
} from './contracts.js';
import { SCAN_EXECUTION_PLAN_VERSION } from './contracts.js';
import { ScanPlanningError } from './errors.js';

interface MutableDataRequirement {
  readonly fields: Set<IndicatorInputField>;
  warmupBars: number;
  operatorHistoryBars: number;
}

interface MutableIndicatorRequest {
  readonly definition: ResolvedIndicatorDefinition;
  readonly operand: IndicatorOperand;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly warmup: WarmupRequirement;
  readonly outputs: Set<string>;
}

interface AstMetrics {
  readonly nodeCount: number;
  readonly groupDepth: number;
}

export function planScanExecution(
  request: ScanPlanningRequest,
  dependencies: ScanPlannerDependencies,
): ScanExecutionPlan {
  validatePlanningInput(request, dependencies);
  const validation = validateScanRule(request.rule);
  if (!validation.valid || validation.normalizedRule === undefined) {
    throw new ScanPlanningError('SCAN_RULE_INVALID', {
      validationErrors: validation.errors,
    });
  }

  const rule = validation.normalizedRule;
  const requestedHistoryBars = request.requestedHistoryBars ?? 1;
  const indicatorRequests = new Map<string, MutableIndicatorRequest>();
  const dataRequirements = new Map<
    IndicatorTimeframe,
    MutableDataRequirement
  >();
  let maximumOperatorHistoryBars = 0;

  visitConditions(rule.root, (condition) => {
    const operatorHistoryBars = resolveOperatorHistoryBars(condition);
    maximumOperatorHistoryBars = Math.max(
      maximumOperatorHistoryBars,
      operatorHistoryBars,
    );
    for (const operand of conditionOperands(condition)) {
      collectOperand(
        operand,
        operatorHistoryBars,
        indicatorRequests,
        dataRequirements,
        dependencies,
      );
    }
  });

  const plannedIndicators = finalizeIndicators(indicatorRequests);
  const plannedData = finalizeDataRequirements(
    dataRequirements,
    requestedHistoryBars,
  );
  const timeframes = plannedData.map(({ timeframe }) => timeframe);
  const metrics = measureAst(rule.root);
  const complexity = calculateComplexity({
    instrumentCount: request.universeInstrumentCount,
    timeframeCount: timeframes.length,
    uniqueIndicatorCount: plannedIndicators.length,
    warmupBars: plannedData.reduce(
      (maximum, requirement) => Math.max(maximum, requirement.warmupBars),
      0,
    ),
    nodeCount: metrics.nodeCount,
    groupDepth: metrics.groupDepth,
    operatorHistoryBars: maximumOperatorHistoryBars,
    requestedHistoryBars,
  });
  if (complexity.score > dependencies.limits.maximumComplexityScore) {
    throw new ScanPlanningError('SCAN_TOO_COMPLEX', {
      complexityScore: complexity.score,
      maximumScore: dependencies.limits.maximumComplexityScore,
    });
  }

  const executionMode =
    complexity.score > dependencies.limits.asynchronousComplexityThreshold
      ? 'async'
      : 'sync';
  const entitlement = dependencies.entitlement.check({
    universeInstrumentCount: request.universeInstrumentCount,
    uniqueIndicatorCount: plannedIndicators.length,
    timeframes,
    complexityScore: complexity.score,
    executionMode,
  });
  if (!entitlement.allowed) {
    throw new ScanPlanningError('SCAN_ENTITLEMENT_VIOLATION', {
      ...(entitlement.reasonCode === undefined
        ? {}
        : { reasonCode: entitlement.reasonCode }),
    });
  }

  return {
    planVersion: SCAN_EXECUTION_PLAN_VERSION,
    universe: {
      filter: rule.universe,
      instrumentCount: request.universeInstrumentCount,
    },
    dataRequirements: plannedData,
    indicatorRequests: plannedIndicators,
    timeframes,
    normalizedRule: rule,
    complexity,
    executionMode,
  };
}

function validatePlanningInput(
  request: ScanPlanningRequest,
  dependencies: ScanPlannerDependencies,
): void {
  if (!Number.isSafeInteger(request.universeInstrumentCount)) {
    throw new ScanPlanningError('SCAN_PLANNING_INPUT_INVALID');
  }
  if (request.universeInstrumentCount <= 0) {
    throw new ScanPlanningError('SCAN_UNIVERSE_EMPTY');
  }
  const history = request.requestedHistoryBars ?? 1;
  if (
    !Number.isSafeInteger(history) ||
    history < 1 ||
    !Number.isSafeInteger(dependencies.limits.maximumComplexityScore) ||
    dependencies.limits.maximumComplexityScore < 1 ||
    !Number.isSafeInteger(
      dependencies.limits.asynchronousComplexityThreshold,
    ) ||
    dependencies.limits.asynchronousComplexityThreshold < 0 ||
    dependencies.limits.asynchronousComplexityThreshold >
      dependencies.limits.maximumComplexityScore
  ) {
    throw new ScanPlanningError('SCAN_PLANNING_INPUT_INVALID');
  }
}

function collectOperand(
  operand: ScanOperand,
  operatorHistoryBars: number,
  indicators: Map<string, MutableIndicatorRequest>,
  data: Map<IndicatorTimeframe, MutableDataRequirement>,
  dependencies: ScanPlannerDependencies,
): void {
  if (operand.type === 'indicator') {
    collectIndicator(
      operand,
      operatorHistoryBars,
      indicators,
      data,
      dependencies,
    );
    return;
  }
  if (operand.type === 'priceField') {
    addDataRequirement(
      data,
      operand.timeframe,
      operand.field,
      0,
      operatorHistoryBars,
    );
  } else if (operand.type === 'volumeField') {
    addDataRequirement(
      data,
      operand.timeframe,
      'volume',
      0,
      operatorHistoryBars,
    );
  }
}

function collectIndicator(
  operand: IndicatorOperand,
  operatorHistoryBars: number,
  indicators: Map<string, MutableIndicatorRequest>,
  data: Map<IndicatorTimeframe, MutableDataRequirement>,
  dependencies: ScanPlannerDependencies,
): void {
  const definition = dependencies.indicatorRegistry.resolve(
    operand.code,
    operand.version,
  );
  const parsed = definition.parseParameters(operand.parameters);
  if (!isRecord(parsed)) {
    throw new ScanPlanningError('SCAN_PLANNING_INPUT_INVALID');
  }
  const parameters = parsed;
  const key = indicatorKey(operand, parameters);
  let planned = indicators.get(key);
  if (planned === undefined) {
    planned = {
      definition,
      operand,
      parameters,
      warmup: definition.getWarmup(parameters),
      outputs: new Set<string>(),
    };
    indicators.set(key, planned);
  }
  if (operand.output !== undefined) planned.outputs.add(operand.output);
  for (const field of definition.catalog.requiredInputFields) {
    addDataRequirement(
      data,
      operand.timeframe,
      field,
      planned.warmup.recommendedWarmupBars,
      operatorHistoryBars,
    );
  }
}

function addDataRequirement(
  data: Map<IndicatorTimeframe, MutableDataRequirement>,
  timeframe: IndicatorTimeframe,
  field: IndicatorInputField,
  warmupBars: number,
  operatorHistoryBars: number,
): void {
  const existing = data.get(timeframe) ?? {
    fields: new Set<IndicatorInputField>(),
    warmupBars: 0,
    operatorHistoryBars: 0,
  };
  existing.fields.add(field);
  existing.warmupBars = Math.max(existing.warmupBars, warmupBars);
  existing.operatorHistoryBars = Math.max(
    existing.operatorHistoryBars,
    operatorHistoryBars,
  );
  data.set(timeframe, existing);
}

function finalizeIndicators(
  indicators: ReadonlyMap<string, MutableIndicatorRequest>,
): readonly PlannedIndicatorRequest[] {
  return [...indicators.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
    .map(([key, planned]) => ({
      key,
      code: planned.operand.code,
      version: planned.operand.version,
      timeframe: planned.operand.timeframe,
      parameters: planned.parameters,
      requestedOutputs: [...planned.outputs].sort((left, right) =>
        left.localeCompare(right, 'en-US'),
      ),
      requiredInputFields: [
        ...planned.definition.catalog.requiredInputFields,
      ].sort(),
      warmup: planned.warmup,
    }));
}

function finalizeDataRequirements(
  data: ReadonlyMap<IndicatorTimeframe, MutableDataRequirement>,
  requestedHistoryBars: number,
): readonly ScanDataRequirement[] {
  return [...data.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
    .map(([timeframe, requirement]) => ({
      timeframe,
      fields: [...requirement.fields].sort(),
      requestedHistoryBars,
      warmupBars: requirement.warmupBars,
      operatorHistoryBars: requirement.operatorHistoryBars,
      requiredBars:
        requestedHistoryBars +
        Math.max(0, requirement.warmupBars - 1) +
        requirement.operatorHistoryBars,
    }));
}

function resolveOperatorHistoryBars(condition: ScanConditionNode): number {
  const requirement = resolveScanOperator(
    condition.operator,
  ).historyRequirement;
  if (requirement === 'previous') return 1;
  if (requirement === 'period')
    return Math.max(0, (condition.options?.period ?? 1) - 1);
  return 0;
}

function visitConditions(
  node: ScanRuleNode,
  visit: (condition: ScanConditionNode) => void,
): void {
  if (node.type === 'condition') {
    visit(node);
    return;
  }
  for (const child of node.children) visitConditions(child, visit);
}

function measureAst(node: ScanRuleNode, depth = 1): AstMetrics {
  if (node.type === 'condition') return { nodeCount: 1, groupDepth: depth - 1 };
  let nodeCount = 1;
  let groupDepth = depth;
  for (const child of node.children) {
    const childMetrics = measureAst(child, depth + 1);
    nodeCount += childMetrics.nodeCount;
    groupDepth = Math.max(groupDepth, childMetrics.groupDepth);
  }
  return { nodeCount, groupDepth };
}

function calculateComplexity(
  factors: Omit<ScanComplexity, 'score'>,
): ScanComplexity {
  const perInstrument =
    1 +
    factors.timeframeCount * 2 +
    factors.uniqueIndicatorCount * 5 +
    Math.ceil(factors.warmupBars / 10) +
    factors.operatorHistoryBars;
  return {
    score:
      factors.instrumentCount * perInstrument +
      factors.nodeCount +
      factors.groupDepth * 2 +
      factors.requestedHistoryBars,
    ...factors,
  };
}

function indicatorKey(
  operand: IndicatorOperand,
  parameters: Readonly<Record<string, unknown>>,
): string {
  return [
    operand.code,
    operand.version,
    operand.timeframe,
    createStableParameterHash(parameters),
  ].join(':');
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
