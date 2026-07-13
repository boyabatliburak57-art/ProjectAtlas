import type { SavedScanApplicationService } from '@atlas/domain';

export const SAVED_SCAN_APPLICATION = Symbol('SAVED_SCAN_APPLICATION');

export type SavedScanCommands = Pick<
  SavedScanApplicationService,
  | 'list'
  | 'get'
  | 'revisions'
  | 'create'
  | 'update'
  | 'delete'
  | 'restore'
  | 'clone'
>;
