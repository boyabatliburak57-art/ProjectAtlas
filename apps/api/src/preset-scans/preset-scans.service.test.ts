import { describe, expect, it, vi } from 'vitest';

import type { ScannerRuntimeService } from '../scanner/scanner-runtime.service';
import type {
  PresetScanReader,
  PublishedPresetScanView,
} from './preset-scans.ports';
import { PresetScansService } from './preset-scans.service';

const published: PublishedPresetScanView = {
  id: '20000000-0000-4000-8000-000000000001',
  code: 'rsi-oversold',
  categoryCode: 'overbought-oversold',
  name: 'RSI Oversold',
  description: 'Daily RSI(14) is below 30.',
  revision: 2,
  ruleVersion: 1,
  rule: { version: 1 },
  complexityScore: 100,
  publishedAt: new Date('2026-07-13T12:00:00.000Z'),
};

function reader(result: PublishedPresetScanView | null): PresetScanReader {
  return {
    categories: () => Promise.resolve([]),
    published: () => Promise.resolve(result === null ? [] : [result]),
    findPublished: () => Promise.resolve(result),
  };
}

describe('PresetScansService', () => {
  it('does not expose an unpublished preset', async () => {
    const service = new PresetScansService(
      reader(null),
      {} as ScannerRuntimeService,
    );

    await expect(service.get('draft-preset')).rejects.toMatchObject({
      status: 404,
      response: { code: 'PRESET_SCAN_NOT_PUBLISHED' },
    });
  });

  it('starts a run with the exact published preset source revision', async () => {
    const createPreset = vi.fn(() =>
      Promise.resolve({
        run: { id: 'run-id' },
        replayed: false,
      }),
    );
    const scanner = { createPreset } as unknown as ScannerRuntimeService;
    const service = new PresetScansService(reader(published), scanner);

    await service.run(
      '00000000-0000-4000-8000-000000000801',
      published.code,
      'preset-run-key',
      'correlation-id',
    );

    expect(createPreset).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000801',
      'preset-run-key',
      {
        id: published.id,
        revision: 2,
        rule: published.rule,
      },
      'correlation-id',
    );
  });
});
