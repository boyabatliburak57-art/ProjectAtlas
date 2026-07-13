import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  dataProviders,
  dataQualityIssues,
  ingestionRuns,
  instruments,
  instrumentSymbolHistory,
  priceBars,
  providerInstrumentMappings,
  presetScanRevisions,
  presetScans,
  savedScanRevisions,
  savedScans,
  savedScanTags,
  scanCategories,
  scanResults,
  scanRunBatches,
  scanRunEvents,
  scanRuns,
  sectors,
} from './index';

describe('initial database schema', () => {
  it('contains only the eight TASK-007 tables', () => {
    expect(
      [
        sectors,
        instruments,
        instrumentSymbolHistory,
        dataProviders,
        providerInstrumentMappings,
        priceBars,
        dataQualityIssues,
        ingestionRuns,
      ].map(getTableName),
    ).toEqual([
      'sectors',
      'instruments',
      'instrument_symbol_history',
      'data_providers',
      'provider_instrument_mappings',
      'price_bars',
      'data_quality_issues',
      'ingestion_runs',
    ]);
  });

  it('exports the ten scanner runtime tables', () => {
    expect(
      [
        scanCategories,
        savedScans,
        savedScanRevisions,
        savedScanTags,
        presetScans,
        presetScanRevisions,
        scanRuns,
        scanRunBatches,
        scanResults,
        scanRunEvents,
      ].map(getTableName),
    ).toEqual([
      'scan_categories',
      'saved_scans',
      'saved_scan_revisions',
      'saved_scan_tags',
      'preset_scans',
      'preset_scan_revisions',
      'scan_runs',
      'scan_run_batches',
      'scan_results',
      'scan_run_events',
    ]);
  });
});
