import {
  createScanOperandKey,
  evaluateScanRule,
  type BatchIndicatorRequest,
  type IndicatorBatchExecutor,
  type IndicatorOutput,
  type PlannedIndicatorRequest,
  type PreparedOperandValue,
  type ScanOperand,
  type ScanRuleNode,
  createStableParameterHash,
} from '@atlas/domain';

import type {
  ScannerInstrumentEvaluation,
  ScannerMarketDataInstrument,
  ScannerWarning,
} from './contracts';

export async function evaluateScannerInstrument(
  instrument: ScannerMarketDataInstrument,
  plan: import('@atlas/domain').ScanExecutionPlan,
  indicatorExecutor: IndicatorBatchExecutor,
): Promise<ScannerInstrumentEvaluation> {
  const requests: BatchIndicatorRequest[] = [];
  const requestedById = new Map<string, PlannedIndicatorRequest>();
  for (const planned of plan.indicatorRequests) {
    const input = instrument.inputs.get(planned.timeframe);
    if (input === undefined) continue;
    const requestId = planned.key;
    requests.push({
      requestId,
      indicatorCode: planned.code,
      indicatorVersion: planned.version,
      parameters: planned.parameters,
      input,
      closedBarPolicy: 'closed-only',
    });
    requestedById.set(requestId, planned);
  }

  const report = await indicatorExecutor.execute(requests);
  const indicatorValues = new Map<string, IndicatorOutput>();
  const warnings: ScannerWarning[] = [...instrument.warnings];
  for (const result of report.results) {
    if (result.status === 'success') {
      indicatorValues.set(result.requestId, result.result.output);
    } else {
      const planned = requestedById.get(result.requestId);
      warnings.push({
        code: result.error.code,
        message: 'Indicator value could not be calculated',
        ...(planned === undefined ? {} : { nodeId: planned.key }),
      });
    }
  }

  const values = new Map<string, PreparedOperandValue>();
  visitOperands(plan.normalizedRule.root, (operand) => {
    const value = resolveOperand(
      operand,
      instrument,
      indicatorValues,
      plan.indicatorRequests,
    );
    if (value !== undefined) values.set(createScanOperandKey(operand), value);
  });
  return {
    values,
    evaluation: evaluateScanRule(plan.normalizedRule, values),
    warnings,
  };
}

function resolveOperand(
  operand: ScanOperand,
  instrument: ScannerMarketDataInstrument,
  indicatorValues: ReadonlyMap<string, IndicatorOutput>,
  plannedRequests: readonly PlannedIndicatorRequest[],
): PreparedOperandValue | undefined {
  if (operand.type === 'constantNumber') {
    return { type: 'number', current: operand.value, previous: operand.value };
  }
  if (operand.type === 'constantBoolean') {
    return { type: 'boolean', current: operand.value };
  }
  if (operand.type === 'marketField') {
    const value = instrument.marketFields[operand.field];
    return typeof value === 'boolean'
      ? { type: 'boolean', current: value }
      : { type: 'number', current: value ?? null };
  }
  if (operand.type === 'priceField' || operand.type === 'volumeField') {
    const input = instrument.inputs.get(operand.timeframe);
    const field = operand.field;
    const series = input?.bars.map((bar) => bar[field]) ?? [];
    return seriesValue(series);
  }

  const parameterHash = createStableParameterHash(operand.parameters);
  const planned = plannedRequests.find(
    (request) =>
      request.code === operand.code &&
      request.version === operand.version &&
      request.timeframe === operand.timeframe &&
      createStableParameterHash(request.parameters) === parameterHash,
  );
  if (planned === undefined) return undefined;
  const output = indicatorValues.get(planned.key);
  if (output === undefined) return undefined;
  if (output.kind === 'scalar') return seriesValue(output.values);
  const outputName = operand.output;
  return outputName === undefined
    ? undefined
    : seriesValue(output.outputs[outputName] ?? []);
}

function seriesValue(series: readonly (number | null)[]): PreparedOperandValue {
  return {
    type: 'number',
    current: series.at(-1) ?? null,
    previous: series.at(-2) ?? null,
  };
}

function visitOperands(
  node: ScanRuleNode,
  visit: (operand: ScanOperand) => void,
): void {
  if (node.type === 'group') {
    for (const child of node.children) visitOperands(child, visit);
    return;
  }
  visit(node.left);
  if (node.right !== undefined) visit(node.right);
  if (node.upperBound !== undefined) visit(node.upperBound);
}
