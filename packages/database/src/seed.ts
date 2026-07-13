import { sql } from 'drizzle-orm';

import type { Database } from './client';
import { dataProviders, scanCategories } from './schema';

const MANUAL_IMPORT_PROVIDER_ID = '00000000-0000-4000-8000-000000000001';

const SCAN_CATEGORY_SEEDS = [
  ['10000000-0000-4000-8000-000000000001', 'trend', 'Trend'],
  ['10000000-0000-4000-8000-000000000002', 'momentum', 'Momentum'],
  ['10000000-0000-4000-8000-000000000003', 'volume', 'Volume'],
  ['10000000-0000-4000-8000-000000000004', 'volatility', 'Volatility'],
  ['10000000-0000-4000-8000-000000000005', 'moving-average', 'Moving Average'],
  ['10000000-0000-4000-8000-000000000006', 'breakout', 'Breakout'],
  [
    '10000000-0000-4000-8000-000000000007',
    'overbought-oversold',
    'Overbought/Oversold',
  ],
  [
    '10000000-0000-4000-8000-000000000008',
    'multi-timeframe',
    'Multi-Timeframe',
  ],
] as const;

export async function seedDatabase(database: Database): Promise<void> {
  await database
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

  for (const [id, code, name] of SCAN_CATEGORY_SEEDS) {
    await database
      .insert(scanCategories)
      .values({ id, code, name, sortOrder: Number(id.slice(-1)) })
      .onConflictDoUpdate({
        set: { active: true, name, updatedAt: sql`now()` },
        target: scanCategories.code,
      });
  }
}
