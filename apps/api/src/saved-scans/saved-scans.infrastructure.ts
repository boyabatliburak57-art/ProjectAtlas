import { PostgresSavedScanRepository } from '@atlas/database';
import { SavedScanApplicationService } from '@atlas/domain';

import { ApiDatabase } from '../scanner/scanner-runtime.infrastructure';

export function createSavedScanApplication(
  connection: ApiDatabase,
): SavedScanApplicationService {
  return new SavedScanApplicationService({
    repository: new PostgresSavedScanRepository(connection.database),
    quota: { check: () => Promise.resolve({ allowed: true }) },
  });
}
