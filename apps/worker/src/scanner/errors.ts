export type ScannerRuntimeErrorCode =
  | 'SCAN_RUN_NOT_FOUND'
  | 'SCAN_RUN_INVALID_STATE'
  | 'SCANNER_BATCH_TIMEOUT'
  | 'SCANNER_RUN_TIMEOUT'
  | 'SCANNER_MARKET_DATA_UNAVAILABLE'
  | 'SCANNER_PERSISTENCE_FAILED'
  | 'SCANNER_DETERMINISTIC_FAILURE';

export class ScannerRuntimeError extends Error {
  override readonly name = 'ScannerRuntimeError';

  constructor(
    readonly code: ScannerRuntimeErrorCode,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(code, options);
  }
}

export function scannerErrorCode(error: unknown): ScannerRuntimeErrorCode {
  return error instanceof ScannerRuntimeError
    ? error.code
    : 'SCANNER_PERSISTENCE_FAILED';
}

export function isScannerErrorRetryable(error: unknown): boolean {
  return !(error instanceof ScannerRuntimeError) || error.retryable;
}
