import { describe, expect, it, vi } from 'vitest';

import type { ScanRuleAst } from '../ast/contracts.js';
import type {
  NewSavedScan,
  ReviseSavedScan,
  ReviseSavedScanResult,
  SavedScanRepository,
  SavedScanRevision,
  SavedScanWithRevision,
} from './contracts.js';
import { SavedScanApplicationService } from './saved-scan-application-service.js';

const ownerId = '00000000-0000-4000-8000-000000000101';
const otherId = '00000000-0000-4000-8000-000000000102';
const fixedNow = new Date('2026-07-13T12:00:00.000Z');
let sequence = 400;

function nextId(): string {
  sequence += 1;
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

function rule(limit = 10): ScanRuleAst {
  return {
    version: 1,
    universe: {
      market: 'BIST',
      statuses: ['active'],
      indexCodes: [],
      sectorIds: [],
    },
    root: {
      type: 'group',
      nodeId: 'root',
      operator: 'AND',
      children: [
        {
          type: 'condition',
          nodeId: 'price',
          operator: 'GT',
          left: { type: 'priceField', field: 'close', timeframe: '1d' },
          right: { type: 'constantNumber', value: limit },
        },
      ],
    },
  };
}

class MemorySavedScanRepository implements SavedScanRepository {
  readonly scans = new Map<string, SavedScanWithRevision>();
  readonly history = new Map<string, SavedScanRevision[]>();

  listOwned(ownerUserId: string, includeDeleted: boolean) {
    return Promise.resolve(
      [...this.scans.values()].filter(
        (scan) =>
          scan.ownerUserId === ownerUserId &&
          (includeDeleted || scan.status === 'active'),
      ),
    );
  }

  findById(id: string) {
    return Promise.resolve(this.scans.get(id) ?? null);
  }

  listRevisions(id: string) {
    return Promise.resolve([...(this.history.get(id) ?? [])].reverse());
  }

  create(input: NewSavedScan) {
    const id = nextId();
    const revision: SavedScanRevision = {
      id: nextId(),
      savedScanId: id,
      revision: 1,
      ruleVersion: input.rule.version,
      rule: structuredClone(input.rule),
      complexityScore: input.complexityScore,
      createdBy: input.createdBy,
      createdAt: input.now,
    };
    const scan: SavedScanWithRevision = {
      id,
      ownerUserId: input.ownerUserId,
      name: input.name,
      description: input.description,
      visibility: 'private',
      status: 'active',
      currentRevision: 1,
      tags: [...input.tags],
      createdAt: input.now,
      updatedAt: input.now,
      deletedAt: null,
      revision,
    };
    this.scans.set(id, scan);
    this.history.set(id, [revision]);
    return Promise.resolve(scan);
  }

  revise(input: ReviseSavedScan): Promise<ReviseSavedScanResult> {
    const current = this.scans.get(input.id);
    if (
      current === undefined ||
      current.ownerUserId !== input.ownerUserId ||
      current.status !== 'active' ||
      current.currentRevision !== input.expectedRevision
    ) {
      return Promise.resolve({ outcome: 'conflict' });
    }
    const revision: SavedScanRevision = {
      id: nextId(),
      savedScanId: input.id,
      revision: input.expectedRevision + 1,
      ruleVersion: input.rule.version,
      rule: structuredClone(input.rule),
      complexityScore: input.complexityScore,
      createdBy: input.createdBy,
      createdAt: input.now,
    };
    const scan: SavedScanWithRevision = {
      ...current,
      name: input.name,
      description: input.description,
      tags: [...input.tags],
      currentRevision: revision.revision,
      updatedAt: input.now,
      revision,
    };
    this.scans.set(input.id, scan);
    this.history.get(input.id)?.push(revision);
    return Promise.resolve({ outcome: 'updated', scan });
  }

  softDelete(id: string, ownerUserId: string, now: Date) {
    return this.changeStatus(id, ownerUserId, 'active', 'deleted', now);
  }

  restore(id: string, ownerUserId: string, now: Date) {
    return this.changeStatus(id, ownerUserId, 'deleted', 'active', now);
  }

  private changeStatus(
    id: string,
    ownerUserId: string,
    from: 'active' | 'deleted',
    to: 'active' | 'deleted',
    now: Date,
  ) {
    const current = this.scans.get(id);
    if (
      current === undefined ||
      current.ownerUserId !== ownerUserId ||
      current.status !== from
    ) {
      return Promise.resolve(null);
    }
    const updated: SavedScanWithRevision = {
      ...current,
      status: to,
      deletedAt: to === 'deleted' ? now : null,
      updatedAt: now,
    };
    this.scans.set(id, updated);
    return Promise.resolve(updated);
  }
}

function setup(quotaAllowed = true) {
  const repository = new MemorySavedScanRepository();
  const check = vi.fn(() => Promise.resolve({ allowed: quotaAllowed }));
  return {
    repository,
    check,
    service: new SavedScanApplicationService({
      repository,
      quota: { check },
      now: () => new Date(fixedNow),
    }),
  };
}

describe('SavedScanApplicationService', () => {
  it('creates immutable revisions and rejects a stale expectedRevision', async () => {
    const { service } = setup();
    const created = await service.create({
      userId: ownerId,
      name: 'Momentum',
      tags: [' BIST ', 'momentum', 'bist'],
      rule: rule(10),
    });
    const updated = await service.update({
      userId: ownerId,
      id: created.id,
      expectedRevision: 1,
      rule: rule(20),
    });

    expect(updated.currentRevision).toBe(2);
    await expect(
      service.update({
        userId: ownerId,
        id: created.id,
        expectedRevision: 1,
        rule: rule(30),
      }),
    ).rejects.toMatchObject({ code: 'SAVED_SCAN_CONFLICT' });
    const revisions = await service.revisions(ownerId, created.id);
    expect(revisions.map(({ revision }) => revision)).toEqual([2, 1]);
    expect(revisions[1]?.rule).toEqual(rule(10));
    expect(revisions[0]?.rule).toEqual(rule(20));
  });

  it('enforces ownership, clone identity, tags and soft delete/restore', async () => {
    const { service } = setup();
    const created = await service.create({
      userId: ownerId,
      name: 'Trend',
      tags: ['Trend', ' swing '],
      rule: rule(),
    });
    await expect(service.get(otherId, created.id)).rejects.toMatchObject({
      code: 'SAVED_SCAN_ACCESS_DENIED',
    });

    const cloned = await service.clone(ownerId, created.id);
    expect(cloned).toMatchObject({
      ownerUserId: ownerId,
      currentRevision: 1,
      tags: ['swing', 'trend'],
    });
    expect(cloned.id).not.toBe(created.id);

    const deleted = await service.delete(ownerId, created.id);
    expect(deleted.status).toBe('deleted');
    await expect(service.clone(ownerId, created.id)).rejects.toMatchObject({
      code: 'SAVED_SCAN_DELETED',
    });
    expect(await service.list(ownerId)).not.toContainEqual(deleted);
    expect(await service.restore(ownerId, created.id)).toMatchObject({
      status: 'active',
    });
  });

  it('uses the quota port for create, clone and revision operations', async () => {
    const denied = setup(false);
    await expect(
      denied.service.create({ userId: ownerId, name: 'Denied', rule: rule() }),
    ).rejects.toMatchObject({ code: 'SAVED_SCAN_QUOTA_EXCEEDED' });
    expect(denied.check).toHaveBeenCalledWith({
      userId: ownerId,
      operation: 'create',
    });

    const allowed = setup();
    const scan = await allowed.service.create({
      userId: ownerId,
      name: 'Allowed',
      rule: rule(),
    });
    await allowed.service.clone(ownerId, scan.id);
    await allowed.service.update({
      userId: ownerId,
      id: scan.id,
      expectedRevision: 1,
      name: 'Updated',
    });
    expect(allowed.check).toHaveBeenCalledWith({
      userId: ownerId,
      operation: 'clone',
      savedScanId: scan.id,
    });
    expect(allowed.check).toHaveBeenCalledWith({
      userId: ownerId,
      operation: 'revision',
      savedScanId: scan.id,
    });
  });
});
