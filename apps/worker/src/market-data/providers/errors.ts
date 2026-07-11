export const PROVIDER_ERROR_CODES = [
  'PROVIDER_AUTHENTICATION_FAILED',
  'PROVIDER_INVALID_SYMBOL_MAPPING',
  'PROVIDER_MALFORMED_RESPONSE',
  'PROVIDER_NOT_REGISTERED',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_UNSUPPORTED_TIMEFRAME',
] as const;

export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

const RETRYABLE_ERROR_CODES: ReadonlySet<ProviderErrorCode> = new Set([
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE',
]);

const SAFE_MESSAGES: Record<ProviderErrorCode, string> = {
  PROVIDER_AUTHENTICATION_FAILED: 'Provider authentication failed',
  PROVIDER_INVALID_SYMBOL_MAPPING: 'Provider symbol mapping is invalid',
  PROVIDER_MALFORMED_RESPONSE: 'Provider returned an invalid response',
  PROVIDER_NOT_REGISTERED: 'Market data provider is not registered',
  PROVIDER_RATE_LIMITED: 'Provider rate limit was reached',
  PROVIDER_TIMEOUT: 'Provider request timed out',
  PROVIDER_UNAVAILABLE: 'Market data provider is unavailable',
  PROVIDER_UNSUPPORTED_TIMEFRAME: 'Provider does not support the timeframe',
};

export class ProviderError extends Error {
  override readonly name = 'ProviderError';
  readonly retryable: boolean;

  constructor(
    readonly code: ProviderErrorCode,
    options?: ErrorOptions,
  ) {
    super(SAFE_MESSAGES[code], options);
    this.retryable = RETRYABLE_ERROR_CODES.has(code);
  }
}
