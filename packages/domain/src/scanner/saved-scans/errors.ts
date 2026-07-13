export type SavedScanErrorCode =
  | 'SAVED_SCAN_NOT_FOUND'
  | 'SAVED_SCAN_ACCESS_DENIED'
  | 'SAVED_SCAN_CONFLICT'
  | 'SAVED_SCAN_DELETED'
  | 'SAVED_SCAN_INVALID'
  | 'SAVED_SCAN_QUOTA_EXCEEDED';

export class SavedScanError extends Error {
  override readonly name = 'SavedScanError';

  constructor(
    readonly code: SavedScanErrorCode,
    readonly details?: unknown,
  ) {
    super(code);
  }
}
