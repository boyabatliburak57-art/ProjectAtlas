export const INDICATOR_TIMEFRAMES = [
  '1m',
  '5m',
  '15m',
  '30m',
  '1h',
  '4h',
  '1d',
  '1w',
] as const;

export type IndicatorTimeframe = (typeof INDICATOR_TIMEFRAMES)[number];
export type AdjustmentMode = 'raw' | 'split-adjusted' | 'total-return';
export type ClosedBarPolicy = 'closed-only' | 'include-open';
export type IndicatorInputField = 'open' | 'high' | 'low' | 'close' | 'volume';
export type IndicatorCategory =
  | 'price'
  | 'momentum'
  | 'trend'
  | 'volatility'
  | 'volume';

export interface IndicatorPriceBar {
  readonly timestamp: Date;
  readonly open: number | null;
  readonly high: number | null;
  readonly low: number | null;
  readonly close: number | null;
  readonly volume: number | null;
  readonly isClosed: boolean;
}

export interface IndicatorInput {
  readonly instrumentId: string;
  readonly timeframe: IndicatorTimeframe;
  readonly bars: readonly IndicatorPriceBar[];
  readonly adjustmentMode: AdjustmentMode;
  readonly dataCutoffAt: Date;
}

export interface DomainSchema<T> {
  readonly metadata: Readonly<Record<string, unknown>>;
  parse(value: unknown): T;
}

export interface WarmupRequirement {
  readonly minimumInputBars: number;
  readonly recommendedWarmupBars: number;
  readonly firstValidIndex: number;
}

export type IndicatorSeries = readonly (number | null)[];

export interface ScalarIndicatorOutput {
  readonly kind: 'scalar';
  readonly values: IndicatorSeries;
}

export interface MultiIndicatorOutput {
  readonly kind: 'multi';
  readonly outputs: Readonly<Record<string, IndicatorSeries>>;
}

export type IndicatorOutput = ScalarIndicatorOutput | MultiIndicatorOutput;

export type IndicatorOutputSpecification =
  | { readonly kind: 'scalar' }
  | {
      readonly kind: 'multi';
      readonly keys: readonly string[];
    };

export interface IndicatorDefinition<
  P,
  O extends IndicatorOutput = IndicatorOutput,
> {
  readonly code: string;
  readonly version: number;
  readonly displayName: string;
  readonly category: IndicatorCategory;
  readonly requiredInputFields: readonly IndicatorInputField[];
  readonly parameterSchema: DomainSchema<P>;
  readonly outputSchema: DomainSchema<O>;
  readonly outputSpecification: IndicatorOutputSpecification;
  readonly documentationReference: string;
  getWarmup(parameters: P): WarmupRequirement;
  calculate(input: IndicatorInput, parameters: P): O;
}

export interface IndicatorRequestMetadata {
  readonly requestId: string;
  readonly requestedAt: Date;
  readonly closedBarPolicy: ClosedBarPolicy;
}

export interface IndicatorCalculationRequest<P> {
  readonly indicatorCode: string;
  readonly indicatorVersion: number;
  readonly parameters: P;
  readonly input: IndicatorInput;
  readonly metadata: IndicatorRequestMetadata;
}

export interface IndicatorResultMetadata {
  readonly indicatorCode: string;
  readonly indicatorVersion: number;
  readonly parameterHash: string;
  readonly instrumentId: string;
  readonly timeframe: IndicatorTimeframe;
  readonly adjustmentMode: AdjustmentMode;
  readonly dataCutoffAt: Date;
  readonly closedBarPolicy: ClosedBarPolicy;
  readonly calculatedAt: Date;
  readonly firstValidIndex: number;
}

export interface IndicatorCalculationResult<
  O extends IndicatorOutput = IndicatorOutput,
> {
  readonly output: O;
  readonly metadata: IndicatorResultMetadata;
}
