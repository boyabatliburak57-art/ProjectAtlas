import {
  presetScanRevisions,
  presetScans,
  scanCategories,
} from '@atlas/database';
import { and, asc, eq } from 'drizzle-orm';

import { ApiDatabase } from '../scanner/scanner-runtime.infrastructure';
import type {
  PresetCategoryView,
  PresetScanReader,
  PublishedPresetScanView,
} from './preset-scans.ports';

export class PostgresPresetScanReader implements PresetScanReader {
  constructor(private readonly connection: ApiDatabase) {}

  async categories(): Promise<readonly PresetCategoryView[]> {
    return this.connection.database
      .select({
        code: scanCategories.code,
        name: scanCategories.name,
        description: scanCategories.description,
        sortOrder: scanCategories.sortOrder,
      })
      .from(scanCategories)
      .where(eq(scanCategories.active, true))
      .orderBy(asc(scanCategories.sortOrder), asc(scanCategories.code));
  }

  async published(
    category?: string,
  ): Promise<readonly PublishedPresetScanView[]> {
    const rows = await this.query(category);
    return rows.map(mapPreset);
  }

  async findPublished(code: string): Promise<PublishedPresetScanView | null> {
    const rows = await this.query(undefined, code);
    return rows[0] === undefined ? null : mapPreset(rows[0]);
  }

  query(category?: string, code?: string) {
    const conditions = [
      eq(presetScans.status, 'published'),
      eq(scanCategories.active, true),
      eq(presetScanRevisions.lifecycleStatus, 'published'),
      eq(presetScanRevisions.revision, presetScans.currentRevision),
    ];
    if (category !== undefined)
      conditions.push(eq(scanCategories.code, category));
    if (code !== undefined) conditions.push(eq(presetScans.code, code));
    return this.connection.database
      .select({
        id: presetScans.id,
        code: presetScans.code,
        categoryCode: scanCategories.code,
        name: presetScans.name,
        description: presetScans.description,
        revision: presetScanRevisions.revision,
        ruleVersion: presetScanRevisions.ruleVersion,
        rule: presetScanRevisions.ruleAst,
        complexityScore: presetScanRevisions.complexityScore,
        publishedAt: presetScanRevisions.publishedAt,
      })
      .from(presetScans)
      .innerJoin(scanCategories, eq(scanCategories.id, presetScans.categoryId))
      .innerJoin(
        presetScanRevisions,
        eq(presetScanRevisions.presetScanId, presetScans.id),
      )
      .where(and(...conditions))
      .orderBy(asc(presetScans.name));
  }
}

type PresetRow = Awaited<ReturnType<PostgresPresetScanReader['query']>>[number];

function mapPreset(row: PresetRow): PublishedPresetScanView {
  if (row.publishedAt === null) {
    throw new Error('Published preset timestamp invariant failed');
  }
  return {
    ...row,
    rule: row.rule,
    complexityScore: Number(row.complexityScore),
    publishedAt: row.publishedAt,
  };
}
