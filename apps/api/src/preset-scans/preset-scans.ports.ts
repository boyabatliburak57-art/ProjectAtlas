export const PRESET_SCAN_READER = Symbol('PRESET_SCAN_READER');

export interface PresetCategoryView {
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly sortOrder: number;
}

export interface PublishedPresetScanView {
  readonly id: string;
  readonly code: string;
  readonly categoryCode: string;
  readonly name: string;
  readonly description: string | null;
  readonly revision: number;
  readonly ruleVersion: number;
  readonly rule: Readonly<Record<string, unknown>>;
  readonly complexityScore: number;
  readonly publishedAt: Date;
}

export interface PresetScanReader {
  categories(): Promise<readonly PresetCategoryView[]>;
  published(category?: string): Promise<readonly PublishedPresetScanView[]>;
  findPublished(code: string): Promise<PublishedPresetScanView | null>;
}
