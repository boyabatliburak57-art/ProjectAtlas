import type { ScanValidationError } from '../ast/contracts.js';

export type ScanRunApplicationErrorCode =
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'SCAN_RULE_INVALID'
  | 'SCAN_UNIVERSE_EMPTY'
  | 'SCAN_RUN_NOT_FOUND'
  | 'SCAN_RUN_ACCESS_DENIED'
  | 'SCAN_RUN_NOT_CANCELLABLE'
  | 'SCAN_RUN_INVALID_TRANSITION'
  | 'SCAN_SOURCE_ACCESS_DENIED'
  | 'SAVED_SCAN_DELETED';

export class ScanRunApplicationError extends Error {
  override readonly name = 'ScanRunApplicationError';

  constructor(
    readonly code: ScanRunApplicationErrorCode,
    readonly details?:
      | { readonly validationErrors: readonly ScanValidationError[] }
      | { readonly fromStatus: string; readonly toStatus: string },
  ) {
    super(code);
  }
}
