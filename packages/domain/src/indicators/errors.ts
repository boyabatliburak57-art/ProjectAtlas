export const INDICATOR_ERROR_CODES = [
  'INDICATOR_NOT_FOUND',
  'INDICATOR_VERSION_NOT_FOUND',
  'INDICATOR_PARAMETERS_INVALID',
  'INDICATOR_INPUT_TOO_SHORT',
  'INDICATOR_INPUT_INVALID',
  'INDICATOR_CALCULATION_FAILED',
  'INDICATOR_OUTPUT_INVALID',
] as const;

export type IndicatorErrorCode = (typeof INDICATOR_ERROR_CODES)[number];

const ERROR_MESSAGES: Record<IndicatorErrorCode, string> = {
  INDICATOR_NOT_FOUND: 'Indicator was not found',
  INDICATOR_VERSION_NOT_FOUND: 'Indicator version was not found',
  INDICATOR_PARAMETERS_INVALID: 'Indicator parameters are invalid',
  INDICATOR_INPUT_TOO_SHORT: 'Indicator input is too short',
  INDICATOR_INPUT_INVALID: 'Indicator input is invalid',
  INDICATOR_CALCULATION_FAILED: 'Indicator calculation failed',
  INDICATOR_OUTPUT_INVALID: 'Indicator output is invalid',
};

export class IndicatorDomainError extends Error {
  override readonly name = 'IndicatorDomainError';

  constructor(
    readonly code: IndicatorErrorCode,
    options?: ErrorOptions,
  ) {
    super(ERROR_MESSAGES[code], options);
  }
}
