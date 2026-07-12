import type { ScanValidationError } from '../ast/contracts.js';

export type ScanPlanningErrorCode =
  | 'SCAN_RULE_INVALID'
  | 'SCAN_UNIVERSE_EMPTY'
  | 'SCAN_TOO_COMPLEX'
  | 'SCAN_ENTITLEMENT_VIOLATION'
  | 'SCAN_PLANNING_INPUT_INVALID';

export class ScanPlanningError extends Error {
  override readonly name = 'ScanPlanningError';

  constructor(
    readonly code: ScanPlanningErrorCode,
    readonly details?:
      | { readonly validationErrors: readonly ScanValidationError[] }
      | { readonly complexityScore: number; readonly maximumScore: number }
      | { readonly reasonCode?: string | undefined },
  ) {
    super(code);
  }
}
