import type {
  NewSavedScan,
  ReviseSavedScan,
  ReviseSavedScanResult,
  SavedScan,
  SavedScanRepository,
  SavedScanRevision,
  SavedScanWithRevision,
} from '@atlas/domain';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';

import type { Database } from '../client';
import { savedScanRevisions, savedScans, savedScanTags } from '../schema';

type ScanRow = typeof savedScans.$inferSelect;
type RevisionRow = typeof savedScanRevisions.$inferSelect;

export class PostgresSavedScanRepository implements SavedScanRepository {
  constructor(private readonly database: Database) {}

  async listOwned(
    ownerUserId: string,
    includeDeleted: boolean,
  ): Promise<readonly SavedScanWithRevision[]> {
    const rows = await this.database
      .select()
      .from(savedScans)
      .where(
        includeDeleted
          ? eq(savedScans.ownerUserId, ownerUserId)
          : and(
              eq(savedScans.ownerUserId, ownerUserId),
              ne(savedScans.status, 'deleted'),
            ),
      )
      .orderBy(desc(savedScans.updatedAt), asc(savedScans.id));
    return this.loadAggregates(rows);
  }

  async findById(id: string): Promise<SavedScanWithRevision | null> {
    const rows = await this.database
      .select()
      .from(savedScans)
      .where(eq(savedScans.id, id))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return (await this.loadAggregates([row]))[0] ?? null;
  }

  async listRevisions(id: string): Promise<readonly SavedScanRevision[]> {
    const rows = await this.database
      .select()
      .from(savedScanRevisions)
      .where(eq(savedScanRevisions.savedScanId, id))
      .orderBy(desc(savedScanRevisions.revision));
    return rows.map(mapRevision);
  }

  create(input: NewSavedScan): Promise<SavedScanWithRevision> {
    return this.database.transaction(async (transaction) => {
      const scan = (
        await transaction
          .insert(savedScans)
          .values({
            ownerUserId: input.ownerUserId,
            name: input.name,
            description: input.description,
            visibility: 'private',
            status: 'active',
            currentRevision: 1,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .returning()
      )[0];
      if (scan === undefined)
        throw new Error('Saved scan insert invariant failed');
      const revision = (
        await transaction
          .insert(savedScanRevisions)
          .values({
            savedScanId: scan.id,
            revision: 1,
            ruleVersion: input.rule.version,
            ruleAst: input.rule as unknown as Record<string, unknown>,
            complexityScore: String(input.complexityScore),
            createdBy: input.createdBy,
            createdAt: input.now,
          })
          .returning()
      )[0];
      if (revision === undefined) {
        throw new Error('Saved scan revision insert invariant failed');
      }
      await insertTags(transaction, scan.id, input.tags, input.now);
      return aggregate(scan, revision, input.tags);
    });
  }

  revise(input: ReviseSavedScan): Promise<ReviseSavedScanResult> {
    return this.database.transaction(async (transaction) => {
      const nextRevision = input.expectedRevision + 1;
      const scan = (
        await transaction
          .update(savedScans)
          .set({
            name: input.name,
            description: input.description,
            currentRevision: nextRevision,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(savedScans.id, input.id),
              eq(savedScans.ownerUserId, input.ownerUserId),
              eq(savedScans.status, 'active'),
              eq(savedScans.currentRevision, input.expectedRevision),
            ),
          )
          .returning()
      )[0];
      if (scan === undefined) return { outcome: 'conflict' };
      const revision = (
        await transaction
          .insert(savedScanRevisions)
          .values({
            savedScanId: scan.id,
            revision: nextRevision,
            ruleVersion: input.rule.version,
            ruleAst: input.rule as unknown as Record<string, unknown>,
            complexityScore: String(input.complexityScore),
            createdBy: input.createdBy,
            createdAt: input.now,
          })
          .returning()
      )[0];
      if (revision === undefined) {
        throw new Error('Saved scan revision insert invariant failed');
      }
      await transaction
        .delete(savedScanTags)
        .where(eq(savedScanTags.savedScanId, scan.id));
      await insertTags(transaction, scan.id, input.tags, input.now);
      return {
        outcome: 'updated',
        scan: aggregate(scan, revision, input.tags),
      };
    });
  }

  async softDelete(
    id: string,
    ownerUserId: string,
    now: Date,
  ): Promise<SavedScanWithRevision | null> {
    const rows = await this.database
      .update(savedScans)
      .set({ status: 'deleted', deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(savedScans.id, id),
          eq(savedScans.ownerUserId, ownerUserId),
          eq(savedScans.status, 'active'),
        ),
      )
      .returning();
    const row = rows[0];
    return row === undefined ? null : this.findById(row.id);
  }

  async restore(
    id: string,
    ownerUserId: string,
    now: Date,
  ): Promise<SavedScanWithRevision | null> {
    const rows = await this.database
      .update(savedScans)
      .set({ status: 'active', deletedAt: null, updatedAt: now })
      .where(
        and(
          eq(savedScans.id, id),
          eq(savedScans.ownerUserId, ownerUserId),
          eq(savedScans.status, 'deleted'),
        ),
      )
      .returning();
    const row = rows[0];
    return row === undefined ? null : this.findById(row.id);
  }

  private async loadAggregates(
    scans: readonly ScanRow[],
  ): Promise<readonly SavedScanWithRevision[]> {
    if (scans.length === 0) return [];
    const ids = scans.map(({ id }) => id);
    const [revisions, tags] = await Promise.all([
      this.database
        .select()
        .from(savedScanRevisions)
        .where(inArray(savedScanRevisions.savedScanId, ids)),
      this.database
        .select()
        .from(savedScanTags)
        .where(inArray(savedScanTags.savedScanId, ids))
        .orderBy(asc(savedScanTags.tag)),
    ]);
    return scans.map((scan) => {
      const revision = revisions.find(
        (candidate) =>
          candidate.savedScanId === scan.id &&
          candidate.revision === scan.currentRevision,
      );
      if (revision === undefined) {
        throw new Error('Saved scan current revision invariant failed');
      }
      return aggregate(
        scan,
        revision,
        tags
          .filter(({ savedScanId }) => savedScanId === scan.id)
          .map(({ tag }) => tag),
      );
    });
  }
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

async function insertTags(
  transaction: Transaction,
  savedScanId: string,
  tags: readonly string[],
  now: Date,
): Promise<void> {
  if (tags.length === 0) return;
  await transaction
    .insert(savedScanTags)
    .values(tags.map((tag) => ({ savedScanId, tag, createdAt: now })));
}

function aggregate(
  scan: ScanRow,
  revision: RevisionRow,
  tags: readonly string[],
): SavedScanWithRevision {
  return { ...mapScan(scan, tags), revision: mapRevision(revision) };
}

function mapScan(row: ScanRow, tags: readonly string[]): SavedScan {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    name: row.name,
    description: row.description,
    visibility: 'private',
    status: row.status as SavedScan['status'],
    currentRevision: row.currentRevision,
    tags: [...tags],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function mapRevision(row: RevisionRow): SavedScanRevision {
  return {
    id: row.id,
    savedScanId: row.savedScanId,
    revision: row.revision,
    ruleVersion: row.ruleVersion,
    rule: row.ruleAst as unknown as SavedScanRevision['rule'],
    complexityScore: Number(row.complexityScore ?? 0),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}
