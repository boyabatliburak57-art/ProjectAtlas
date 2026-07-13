import type {
  IndicatorOperand,
  ScanConditionNode,
  ScanRuleAst,
  ScanRuleNode,
} from '../ast/contracts.js';

export interface PresetCategoryDefinition {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly sortOrder: number;
}

export interface PresetScanDefinition {
  readonly id: string;
  readonly code: string;
  readonly categoryCode: string;
  readonly name: string;
  readonly description: string;
  readonly revision: 1;
  readonly rule: ScanRuleAst;
}

const macdParameters = {
  fastPeriod: 12,
  slowPeriod: 26,
  signalPeriod: 9,
} as const;

export const PRESET_CATEGORY_DEFINITIONS: readonly PresetCategoryDefinition[] =
  [
    category(1, 'trend', 'Trend'),
    category(2, 'momentum', 'Momentum'),
    category(3, 'volume', 'Volume'),
    category(4, 'volatility', 'Volatility'),
    category(5, 'moving-average', 'Moving Average'),
    category(6, 'breakout', 'Breakout'),
    category(7, 'overbought-oversold', 'Overbought/Oversold'),
    category(8, 'multi-timeframe', 'Multi-Timeframe'),
  ];

export const PRESET_SCAN_DEFINITIONS: readonly PresetScanDefinition[] = [
  preset(
    1,
    'rsi-oversold',
    'overbought-oversold',
    'RSI Oversold',
    'Daily RSI(14) is below 30 using the latest closed 1d bar.',
    condition('rsi-oversold', 'LT', indicator('RSI', { period: 14 }), 30),
  ),
  preset(
    2,
    'rsi-recovery',
    'momentum',
    'RSI Recovery',
    'Daily RSI(14) crosses above 30 on the latest closed 1d bar.',
    condition(
      'rsi-recovery',
      'CROSSES_ABOVE',
      indicator('RSI', { period: 14 }),
      30,
    ),
  ),
  preset(
    3,
    'ema-20-50-bullish-cross',
    'moving-average',
    'EMA 20/50 Bullish Cross',
    'Daily EMA(20) crosses above EMA(50) on the latest closed 1d bar.',
    indicatorCondition(
      'ema-cross',
      'CROSSES_ABOVE',
      indicator('EMA', { period: 20 }),
      indicator('EMA', { period: 50 }),
    ),
  ),
  preset(
    4,
    'macd-bullish-cross',
    'momentum',
    'MACD Bullish Cross',
    'Daily MACD(12,26,9) line crosses above its signal on the latest closed bar.',
    indicatorCondition(
      'macd-cross',
      'CROSSES_ABOVE',
      indicator('MACD', macdParameters, 'macd'),
      indicator('MACD', macdParameters, 'signal'),
    ),
  ),
  preset(
    5,
    'price-above-sma-200',
    'moving-average',
    'Price Above SMA 200',
    'Daily close is above SMA(200) using the latest closed 1d bar.',
    priceIndicatorCondition(
      'price-above-sma',
      'GT',
      indicator('SMA', { period: 200 }),
    ),
  ),
  preset(
    6,
    'relative-volume-spike',
    'volume',
    'Relative Volume Spike',
    'Daily volume is greater than 2x its 20-day average on the latest closed bar.',
    condition(
      'relative-volume-spike',
      'GT',
      indicator('RELATIVE_VOLUME', { period: 20 }),
      2,
    ),
  ),
  preset(
    7,
    'bollinger-lower-band-recovery',
    'volatility',
    'Bollinger Lower Band Recovery',
    'Daily close crosses above the lower Bollinger(20,2) band on the latest closed bar.',
    priceIndicatorCondition(
      'bollinger-recovery',
      'CROSSES_ABOVE',
      indicator('BOLLINGER_BANDS', { period: 20, multiplier: 2 }, 'lower'),
    ),
  ),
  preset(
    8,
    'donchian-20-breakout',
    'breakout',
    'Donchian 20 Breakout',
    'Daily close crosses above the Donchian(20) upper channel on the latest closed bar.',
    priceIndicatorCondition(
      'donchian-breakout',
      'CROSSES_ABOVE',
      indicator('DONCHIAN_CHANNEL', { period: 20 }, 'upper'),
    ),
  ),
  preset(
    9,
    'supertrend-positive',
    'trend',
    'Supertrend Positive',
    'Daily Supertrend(10,3) direction is positive on the latest closed 1d bar.',
    condition(
      'supertrend-positive',
      'EQ',
      indicator('SUPERTREND', { period: 10, multiplier: 3 }, 'direction'),
      1,
    ),
  ),
  preset(
    10,
    'adx-trend-strength',
    'trend',
    'ADX Trend Strength',
    'Daily ADX(14) is above 25 on the latest closed 1d bar.',
    condition(
      'adx-strength',
      'GT',
      indicator('ADX', { period: 14 }, 'adx'),
      25,
    ),
  ),
];

function category(
  ordinal: number,
  code: string,
  name: string,
): PresetCategoryDefinition {
  return {
    id: `10000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`,
    code,
    name,
    sortOrder: ordinal,
  };
}

function preset(
  ordinal: number,
  code: string,
  categoryCode: string,
  name: string,
  description: string,
  node: ScanRuleNode,
): PresetScanDefinition {
  return {
    id: `20000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`,
    code,
    categoryCode,
    name,
    description,
    revision: 1,
    rule: {
      version: 1,
      universe: {
        market: 'BIST',
        statuses: ['active'],
        indexCodes: [],
        sectorIds: [],
      },
      root: {
        type: 'group',
        nodeId: 'root',
        operator: 'AND',
        children: [node],
      },
    },
  };
}

function indicator(
  code: string,
  parameters: Readonly<Record<string, unknown>>,
  output?: string,
): IndicatorOperand {
  return {
    type: 'indicator',
    code,
    version: 1,
    ...(output === undefined ? {} : { output }),
    timeframe: '1d',
    parameters,
  };
}

function condition(
  nodeId: string,
  operator: ScanConditionNode['operator'],
  left: IndicatorOperand,
  value: number,
): ScanConditionNode {
  return {
    type: 'condition',
    nodeId,
    operator,
    left,
    right: { type: 'constantNumber', value },
  };
}

function indicatorCondition(
  nodeId: string,
  operator: ScanConditionNode['operator'],
  left: IndicatorOperand,
  right: IndicatorOperand,
): ScanConditionNode {
  return { type: 'condition', nodeId, operator, left, right };
}

function priceIndicatorCondition(
  nodeId: string,
  operator: ScanConditionNode['operator'],
  right: IndicatorOperand,
): ScanConditionNode {
  return {
    type: 'condition',
    nodeId,
    operator,
    left: { type: 'priceField', field: 'close', timeframe: '1d' },
    right,
  };
}
