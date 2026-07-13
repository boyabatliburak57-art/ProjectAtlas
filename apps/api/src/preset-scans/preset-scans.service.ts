import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { ScanRunDto } from '../scanner/scanner-runtime.dto';
import { ScannerRuntimeService } from '../scanner/scanner-runtime.service';
import {
  PRESET_SCAN_READER,
  type PresetScanReader,
} from './preset-scans.ports';

@Injectable()
export class PresetScansService {
  constructor(
    @Inject(PRESET_SCAN_READER) private readonly reader: PresetScanReader,
    private readonly scanner: ScannerRuntimeService,
  ) {}

  categories() {
    return this.reader.categories();
  }

  list(category?: string) {
    return this.reader.published(category);
  }

  async get(code: string) {
    return this.requirePublished(code);
  }

  async run(
    userId: string,
    code: string,
    idempotencyKey: string | undefined,
    correlationId: string,
  ): Promise<{ readonly run: ScanRunDto; readonly replayed: boolean }> {
    const preset = await this.requirePublished(code);
    return this.scanner.createPreset(
      userId,
      idempotencyKey,
      {
        id: preset.id,
        revision: preset.revision,
        rule: preset.rule,
      },
      correlationId,
    );
  }

  private async requirePublished(code: string) {
    const preset = await this.reader.findPublished(code);
    if (preset === null) {
      throw new NotFoundException({
        code: 'PRESET_SCAN_NOT_PUBLISHED',
        message: 'Published preset scan was not found',
      });
    }
    return preset;
  }
}
