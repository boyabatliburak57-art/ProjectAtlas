import {
  SavedScanError,
  type SavedScanApplicationService,
} from '@atlas/domain';
import { describe, expect, it, vi } from 'vitest';

import type { SavedScanCommands } from './saved-scans.ports';
import { SavedScansService } from './saved-scans.service';

const scanId = '00000000-0000-4000-8000-000000000501';

describe('SavedScansService', () => {
  it('maps a stale expectedRevision to HTTP 409 SAVED_SCAN_CONFLICT', async () => {
    const update = vi.fn<Pick<SavedScanApplicationService, 'update'>['update']>(
      () => Promise.reject(new SavedScanError('SAVED_SCAN_CONFLICT')),
    );
    const commands = {
      update,
    } as unknown as SavedScanCommands;
    const service = new SavedScansService(commands);

    await expect(
      service.update('00000000-0000-4000-8000-000000000502', scanId, {
        expectedRevision: 1,
        name: 'Stale update',
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'SAVED_SCAN_CONFLICT' },
    });
    expect(update).toHaveBeenCalledWith({
      userId: '00000000-0000-4000-8000-000000000502',
      id: scanId,
      expectedRevision: 1,
      name: 'Stale update',
    });
  });
});
