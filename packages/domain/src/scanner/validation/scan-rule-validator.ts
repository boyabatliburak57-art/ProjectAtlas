import { INDICATOR_TIMEFRAMES } from '../../indicators/contracts.js';
import type {
  ConstantBooleanOperand,
  ConstantNumberOperand,
  IndicatorOperand,
  MarketFieldOperand,
  PriceFieldOperand,
  ScanConditionNode,
  ScanConditionOptions,
  ScanGroupNode,
  ScanOperand,
  ScanRuleNode,
  ScanRuleValidationResult,
  ScanUniverseFilter,
  ScanUniverseStatus,
  ScanValidationError,
  ScanValidationLimits,
  VolumeFieldOperand,
} from '../ast/contracts.js';
import {
  SCAN_GROUP_OPERATORS,
  SCAN_OPERATORS,
  SCAN_RULE_VERSION,
} from '../ast/contracts.js';
import {
  conditionOperands,
  operandValueType,
  resolveScanOperator,
} from '../operators/operator-registry.js';
import { normalizeScanRule } from '../normalization/normalize-scan-rule.js';

export const DEFAULT_SCAN_VALIDATION_LIMITS: ScanValidationLimits = {
  maxDepth: 8,
  maxNodes: 100,
};

interface ValidationContext {
  readonly errors: ScanValidationError[];
  readonly nodeIds: Set<string>;
  readonly limits: ScanValidationLimits;
  nodeCount: number;
}

export function validateScanRule(
  value: unknown,
  limits: ScanValidationLimits = DEFAULT_SCAN_VALIDATION_LIMITS,
): ScanRuleValidationResult {
  const context: ValidationContext = {
    errors: [],
    nodeIds: new Set(),
    limits,
    nodeCount: 0,
  };
  if (!isRecord(value)) {
    add(context, 'INVALID_NODE', '/', 'Scan rule must be an object');
    return result(context);
  }
  exactKeys(context, value, ['version', 'universe', 'root'], '/');
  if (value.version !== SCAN_RULE_VERSION) {
    add(
      context,
      'SCAN_RULE_VERSION_UNSUPPORTED',
      '/version',
      'Only scan rule version 1 is supported',
    );
  }
  const universe = parseUniverse(value.universe, '/universe', context);
  const root = parseNode(value.root, '/root', 1, context);
  if (root !== null && root.type !== 'group') {
    add(
      context,
      'INVALID_NODE',
      '/root/type',
      'Root node must be a group',
      root.nodeId,
    );
  }

  const ast =
    value.version === SCAN_RULE_VERSION &&
    universe !== null &&
    root?.type === 'group'
      ? { version: SCAN_RULE_VERSION, universe, root }
      : undefined;
  if (context.errors.length === 0 && ast !== undefined) {
    return { valid: true, normalizedRule: normalizeScanRule(ast), errors: [] };
  }
  return result(context);
}

function parseUniverse(
  value: unknown,
  path: string,
  context: ValidationContext,
): ScanUniverseFilter | null {
  if (!isRecord(value)) {
    add(context, 'INVALID_FIELD', path, 'Universe must be an object');
    return null;
  }
  exactKeys(
    context,
    value,
    ['market', 'statuses', 'indexCodes', 'sectorIds'],
    path,
  );
  if (value.market !== 'BIST') {
    add(
      context,
      'INVALID_FIELD',
      `${path}/market`,
      'Only BIST market is supported',
    );
  }
  const statuses = stringArray(value.statuses, `${path}/statuses`, context);
  const indexCodes = stringArray(
    value.indexCodes,
    `${path}/indexCodes`,
    context,
  );
  const sectorIds = stringArray(value.sectorIds, `${path}/sectorIds`, context);
  const allowedStatuses: readonly ScanUniverseStatus[] = [
    'active',
    'inactive',
    'delisted',
  ];
  if (statuses !== null) {
    if (statuses.length === 0) {
      add(
        context,
        'INVALID_FIELD',
        `${path}/statuses`,
        'At least one status is required',
      );
    }
    statuses.forEach((status, index) => {
      if (!allowedStatuses.includes(status as ScanUniverseStatus)) {
        add(
          context,
          'INVALID_FIELD',
          `${path}/statuses/${index}`,
          'Universe status is not supported',
        );
      }
    });
  }
  if (
    value.market !== 'BIST' ||
    statuses === null ||
    indexCodes === null ||
    sectorIds === null ||
    statuses.length === 0 ||
    statuses.some(
      (status) => !allowedStatuses.includes(status as ScanUniverseStatus),
    )
  ) {
    return null;
  }
  return {
    market: 'BIST',
    statuses: statuses as ScanUniverseStatus[],
    indexCodes,
    sectorIds,
  };
}

function parseNode(
  value: unknown,
  path: string,
  depth: number,
  context: ValidationContext,
): ScanRuleNode | null {
  context.nodeCount += 1;
  if (context.nodeCount === context.limits.maxNodes + 1) {
    add(
      context,
      'NODE_LIMIT_EXCEEDED',
      path,
      'Maximum node count was exceeded',
    );
  }
  if (depth > context.limits.maxDepth) {
    add(
      context,
      'DEPTH_LIMIT_EXCEEDED',
      path,
      'Maximum group depth was exceeded',
    );
  }
  if (!isRecord(value)) {
    add(context, 'INVALID_NODE', path, 'Rule node must be an object');
    return null;
  }
  const nodeId = parseNodeId(value.nodeId, `${path}/nodeId`, context);
  if (value.type === 'group')
    return parseGroup(value, path, depth, nodeId, context);
  if (value.type === 'condition')
    return parseCondition(value, path, nodeId, context);
  add(
    context,
    'INVALID_NODE',
    `${path}/type`,
    'Node type is not supported',
    nodeId,
  );
  return null;
}

function parseGroup(
  value: Record<string, unknown>,
  path: string,
  depth: number,
  nodeId: string | null,
  context: ValidationContext,
): ScanGroupNode | null {
  exactKeys(context, value, ['type', 'nodeId', 'operator', 'children'], path);
  if (!isOneOf(value.operator, SCAN_GROUP_OPERATORS)) {
    add(
      context,
      'INVALID_FIELD',
      `${path}/operator`,
      'Group operator must be AND or OR',
      nodeId,
    );
  }
  if (!Array.isArray(value.children)) {
    add(
      context,
      'INVALID_FIELD',
      `${path}/children`,
      'Group children must be an array',
      nodeId,
    );
    return null;
  }
  if (value.children.length === 0) {
    add(
      context,
      'EMPTY_GROUP',
      `${path}/children`,
      'Group must contain at least one child',
      nodeId,
    );
  }
  const children = value.children
    .map((child, index) =>
      parseNode(child, `${path}/children/${index}`, depth + 1, context),
    )
    .filter((child): child is ScanRuleNode => child !== null);
  return nodeId !== null && isOneOf(value.operator, SCAN_GROUP_OPERATORS)
    ? { type: 'group', nodeId, operator: value.operator, children }
    : null;
}

function parseCondition(
  value: Record<string, unknown>,
  path: string,
  nodeId: string | null,
  context: ValidationContext,
): ScanConditionNode | null {
  exactKeys(
    context,
    value,
    ['type', 'nodeId', 'operator', 'left', 'right', 'upperBound', 'options'],
    path,
  );
  if (!isOneOf(value.operator, SCAN_OPERATORS)) {
    add(
      context,
      'OPERATOR_NOT_SUPPORTED',
      `${path}/operator`,
      'Condition operator is not supported',
      nodeId,
    );
    return null;
  }
  const left = parseOperand(value.left, `${path}/left`, context, nodeId);
  const right =
    value.right === undefined
      ? undefined
      : parseOperand(value.right, `${path}/right`, context, nodeId);
  const upperBound =
    value.upperBound === undefined
      ? undefined
      : parseOperand(value.upperBound, `${path}/upperBound`, context, nodeId);
  const options = parseOptions(
    value.options,
    `${path}/options`,
    context,
    nodeId,
  );
  if (
    nodeId === null ||
    left === null ||
    right === null ||
    upperBound === null ||
    options === null
  )
    return null;
  const node: ScanConditionNode = {
    type: 'condition',
    nodeId,
    operator: value.operator,
    left,
    ...(right === undefined ? {} : { right }),
    ...(upperBound === undefined ? {} : { upperBound }),
    ...(options === undefined ? {} : { options }),
  };
  validateCompatibility(node, path, context);
  return node;
}

function parseOptions(
  value: unknown,
  path: string,
  context: ValidationContext,
  nodeId: string | null,
): ScanConditionOptions | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    add(
      context,
      'INVALID_FIELD',
      path,
      'Condition options must be an object',
      nodeId,
    );
    return null;
  }
  exactKeys(context, value, ['period', 'percent'], path, nodeId);
  const options: { period?: number; percent?: number } = {};
  if (value.period !== undefined) {
    if (!Number.isInteger(value.period) || (value.period as number) < 1) {
      add(
        context,
        'INVALID_FIELD',
        `${path}/period`,
        'Period must be a positive integer',
        nodeId,
      );
    } else options.period = value.period as number;
  }
  if (value.percent !== undefined) {
    if (
      typeof value.percent !== 'number' ||
      !Number.isFinite(value.percent) ||
      value.percent < 0
    ) {
      add(
        context,
        'INVALID_FIELD',
        `${path}/percent`,
        'Percent must be finite and non-negative',
        nodeId,
      );
    } else options.percent = value.percent;
  }
  return options;
}

function validateCompatibility(
  node: ScanConditionNode,
  path: string,
  context: ValidationContext,
): void {
  const definition = resolveScanOperator(node.operator);
  const operands = conditionOperands(node);
  if (operands.length !== definition.arity) {
    add(
      context,
      'OPERAND_TYPES_INCOMPATIBLE',
      path,
      `Operator ${node.operator} requires ${definition.arity} operand(s)`,
      node.nodeId,
    );
  }
  if (
    operands.some(
      (operand) => operandValueType(operand) !== definition.valueType,
    )
  ) {
    add(
      context,
      'OPERAND_TYPES_INCOMPATIBLE',
      path,
      `Operator ${node.operator} requires ${definition.valueType} operands`,
      node.nodeId,
    );
  }
  if (
    definition.requiredOption !== undefined &&
    node.options?.[definition.requiredOption] === undefined
  ) {
    add(
      context,
      'OPERAND_TYPES_INCOMPATIBLE',
      `${path}/options/${definition.requiredOption}`,
      `Operator ${node.operator} requires ${definition.requiredOption}`,
      node.nodeId,
    );
  }
  const allowedOptions =
    definition.requiredOption === undefined ? [] : [definition.requiredOption];
  if (
    (node.options?.period !== undefined &&
      !allowedOptions.includes('period')) ||
    (node.options?.percent !== undefined && !allowedOptions.includes('percent'))
  ) {
    add(
      context,
      'OPERAND_TYPES_INCOMPATIBLE',
      `${path}/options`,
      `Operator ${node.operator} does not accept these options`,
      node.nodeId,
    );
  }
}

function parseOperand(
  value: unknown,
  path: string,
  context: ValidationContext,
  nodeId: string | null,
): ScanOperand | null {
  if (!isRecord(value)) {
    add(context, 'INVALID_OPERAND', path, 'Operand must be an object', nodeId);
    return null;
  }
  switch (value.type) {
    case 'indicator':
      return parseIndicatorOperand(value, path, context, nodeId);
    case 'priceField':
      return parsePriceOperand(value, path, context, nodeId);
    case 'volumeField':
      return parseVolumeOperand(value, path, context, nodeId);
    case 'marketField':
      return parseMarketOperand(value, path, context, nodeId);
    case 'constantNumber':
      return parseNumberOperand(value, path, context, nodeId);
    case 'constantBoolean':
      return parseBooleanOperand(value, path, context, nodeId);
    default:
      add(
        context,
        'INVALID_OPERAND',
        `${path}/type`,
        'Operand type is not supported',
        nodeId,
      );
      return null;
  }
}

function parseIndicatorOperand(
  value: Record<string, unknown>,
  path: string,
  context: ValidationContext,
  nodeId: string | null,
): IndicatorOperand | null {
  exactKeys(
    context,
    value,
    ['type', 'code', 'version', 'output', 'timeframe', 'parameters'],
    path,
    nodeId,
  );
  const valid =
    typeof value.code === 'string' &&
    /^[A-Z][A-Z0-9_]{1,63}$/.test(value.code) &&
    Number.isInteger(value.version) &&
    (value.version as number) > 0 &&
    isOneOf(value.timeframe, INDICATOR_TIMEFRAMES) &&
    isRecord(value.parameters) &&
    isJsonValue(value.parameters) &&
    (value.output === undefined ||
      (typeof value.output === 'string' &&
        /^[a-z][a-zA-Z0-9_]{0,63}$/.test(value.output)));
  if (!valid) {
    add(
      context,
      'INVALID_OPERAND',
      path,
      'Indicator operand is invalid',
      nodeId,
    );
    return null;
  }
  return {
    type: 'indicator',
    code: value.code as string,
    version: value.version as number,
    timeframe: value.timeframe as IndicatorOperand['timeframe'],
    parameters: value.parameters as Record<string, unknown>,
    ...(value.output === undefined ? {} : { output: value.output as string }),
  };
}

function parsePriceOperand(
  value: Record<string, unknown>,
  path: string,
  context: ValidationContext,
  nodeId: string | null,
): PriceFieldOperand | null {
  exactKeys(context, value, ['type', 'field', 'timeframe'], path, nodeId);
  const fields = ['open', 'high', 'low', 'close'] as const;
  if (
    !isOneOf(value.field, fields) ||
    !isOneOf(value.timeframe, INDICATOR_TIMEFRAMES)
  ) {
    add(
      context,
      'INVALID_OPERAND',
      path,
      'Price field operand is invalid',
      nodeId,
    );
    return null;
  }
  return { type: 'priceField', field: value.field, timeframe: value.timeframe };
}

function parseVolumeOperand(
  value: Record<string, unknown>,
  path: string,
  context: ValidationContext,
  nodeId: string | null,
): VolumeFieldOperand | null {
  exactKeys(context, value, ['type', 'field', 'timeframe'], path, nodeId);
  if (
    value.field !== 'volume' ||
    !isOneOf(value.timeframe, INDICATOR_TIMEFRAMES)
  ) {
    add(
      context,
      'INVALID_OPERAND',
      path,
      'Volume field operand is invalid',
      nodeId,
    );
    return null;
  }
  return { type: 'volumeField', field: 'volume', timeframe: value.timeframe };
}

function parseMarketOperand(
  value: Record<string, unknown>,
  path: string,
  context: ValidationContext,
  nodeId: string | null,
): MarketFieldOperand | null {
  exactKeys(context, value, ['type', 'field'], path, nodeId);
  const fields: readonly MarketFieldOperand['field'][] = [
    'marketCap',
    'freeFloatMarketCap',
    'averageVolume',
    'isIndexMember',
    'isActive',
  ];
  if (!isOneOf(value.field, fields)) {
    add(
      context,
      'INVALID_OPERAND',
      `${path}/field`,
      'Market field is not supported',
      nodeId,
    );
    return null;
  }
  return { type: 'marketField', field: value.field };
}

function parseNumberOperand(
  value: Record<string, unknown>,
  path: string,
  context: ValidationContext,
  nodeId: string | null,
): ConstantNumberOperand | null {
  exactKeys(context, value, ['type', 'value'], path, nodeId);
  if (typeof value.value !== 'number' || !Number.isFinite(value.value)) {
    add(
      context,
      'INVALID_OPERAND',
      `${path}/value`,
      'Number constant must be finite',
      nodeId,
    );
    return null;
  }
  return { type: 'constantNumber', value: value.value };
}

function parseBooleanOperand(
  value: Record<string, unknown>,
  path: string,
  context: ValidationContext,
  nodeId: string | null,
): ConstantBooleanOperand | null {
  exactKeys(context, value, ['type', 'value'], path, nodeId);
  if (typeof value.value !== 'boolean') {
    add(
      context,
      'INVALID_OPERAND',
      `${path}/value`,
      'Boolean constant is invalid',
      nodeId,
    );
    return null;
  }
  return { type: 'constantBoolean', value: value.value };
}

function parseNodeId(
  value: unknown,
  path: string,
  context: ValidationContext,
): string | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    add(context, 'INVALID_FIELD', path, 'nodeId format is invalid');
    return null;
  }
  if (context.nodeIds.has(value)) {
    add(context, 'DUPLICATE_NODE_ID', path, 'nodeId must be unique', value);
  }
  context.nodeIds.add(value);
  return value;
}

function stringArray(
  value: unknown,
  path: string,
  context: ValidationContext,
): string[] | null {
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        typeof item !== 'string' ||
        item.trim().length === 0 ||
        item.length > 64 ||
        !/^[A-Za-z0-9_-]+$/.test(item),
    )
  ) {
    add(
      context,
      'INVALID_FIELD',
      path,
      'Expected an array of allowlisted identifiers',
    );
    return null;
  }
  return value.map((item) => item as string);
}

function exactKeys(
  context: ValidationContext,
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  nodeId?: string | null,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      add(
        context,
        'INVALID_FIELD',
        join(path, key),
        'Unknown fields are not allowed',
        nodeId ?? undefined,
      );
    }
  }
}

function isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, ancestors))
    : isRecord(value) &&
      Object.values(value).every((item) => isJsonValue(item, ancestors));
  ancestors.delete(value);
  return valid;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isOneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): value is T[number] {
  return typeof value === 'string' && allowed.includes(value);
}

function add(
  context: ValidationContext,
  code: ScanValidationError['code'],
  path: string,
  message: string,
  nodeId?: string | null,
): void {
  context.errors.push({
    code,
    path,
    message,
    ...(nodeId === undefined || nodeId === null ? {} : { nodeId }),
  });
}

function join(path: string, key: string): string {
  return path === '/' ? `/${key}` : `${path}/${key}`;
}

function result(context: ValidationContext): ScanRuleValidationResult {
  return { valid: false, errors: context.errors };
}
