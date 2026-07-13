import { sql } from 'drizzle-orm';
import {
  createCoreIndicatorRegistry,
  planScanExecution,
  PRESET_CATEGORY_DEFINITIONS,
  PRESET_SCAN_DEFINITIONS,
  validateScanRule,
} from '@atlas/domain';

import type { Database } from './client';
import {
  dataProviders,
  presetScanRevisions,
  presetScans,
  scanCategories,
} from './schema';

const MANUAL_IMPORT_PROVIDER_ID = '00000000-0000-4000-8000-000000000001';
const CATALOG_PUBLISHER_ID = '00000000-0000-4000-8000-000000000027';

export async function seedDatabase(database: Database): Promise<void> {
  const plans = validatePresetCatalog();
  await database.transaction(async (transaction) => {
    await transaction
      .insert(dataProviders)
      .values({
        code: 'manual-import',
        id: MANUAL_IMPORT_PROVIDER_ID,
        name: 'Manual Import',
        status: 'inactive',
      })
      .onConflictDoUpdate({
        set: {
          name: 'Manual Import',
          status: 'inactive',
          updatedAt: sql`now()`,
        },
        target: dataProviders.code,
      });

    for (const category of PRESET_CATEGORY_DEFINITIONS) {
      await transaction
        .insert(scanCategories)
        .values(category)
        .onConflictDoUpdate({
          set: {
            active: true,
            name: category.name,
            sortOrder: category.sortOrder,
            updatedAt: sql`now()`,
          },
          target: scanCategories.code,
        });
    }

    for (const definition of PRESET_SCAN_DEFINITIONS) {
      const category = PRESET_CATEGORY_DEFINITIONS.find(
        ({ code }) => code === definition.categoryCode,
      );
      const plan = plans.get(definition.code);
      if (category === undefined || plan === undefined) {
        throw new Error(`Preset seed invariant failed: ${definition.code}`);
      }
      const preset = (
        await transaction
          .insert(presetScans)
          .values({
            id: definition.id,
            code: definition.code,
            categoryId: category.id,
            name: definition.name,
            description: definition.description,
            status: 'published',
            currentRevision: definition.revision,
          })
          .onConflictDoUpdate({
            set: {
              categoryId: category.id,
              name: definition.name,
              description: definition.description,
              status: 'published',
              currentRevision: definition.revision,
              archivedAt: null,
              updatedAt: sql`now()`,
            },
            target: presetScans.code,
          })
          .returning({ id: presetScans.id })
      )[0];
      if (preset === undefined)
        throw new Error('Preset upsert invariant failed');
      await transaction
        .insert(presetScanRevisions)
        .values({
          presetScanId: preset.id,
          revision: definition.revision,
          ruleVersion: definition.rule.version,
          ruleAst: definition.rule as unknown as Record<string, unknown>,
          complexityScore: String(plan.complexity.score),
          lifecycleStatus: 'published',
          createdBy: CATALOG_PUBLISHER_ID,
          publishedBy: CATALOG_PUBLISHER_ID,
          publishedAt: sql`now()`,
        })
        .onConflictDoNothing({
          target: [
            presetScanRevisions.presetScanId,
            presetScanRevisions.revision,
          ],
        });
    }
  });
}

function validatePresetCatalog() {
  const registry = createCoreIndicatorRegistry();
  return new Map(
    PRESET_SCAN_DEFINITIONS.map((definition) => {
      const validation = validateScanRule(definition.rule);
      if (!validation.valid) {
        throw new Error(`Invalid preset AST: ${definition.code}`);
      }
      const plan = planScanExecution(
        {
          rule: definition.rule,
          universeInstrumentCount: 100,
          requestedHistoryBars: 1,
        },
        {
          indicatorRegistry: registry,
          entitlement: { check: () => ({ allowed: true }) },
          limits: {
            maximumComplexityScore: 1_000_000,
            asynchronousComplexityThreshold: 100_000,
          },
        },
      );
      return [definition.code, plan] as const;
    }),
  );
}
