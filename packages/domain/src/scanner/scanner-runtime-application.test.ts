import { describe, expect, it, vi } from 'vitest';

import { createCoreIndicatorRegistry } from '../indicators/registry/indicator-registry.js';
import type { ScanRuleAst } from './ast/contracts.js';
import type {
  IdempotentScanRunCreation,
  NewScanRun,
  ScanRun,
  ScanRunRepository,
  ScanSourceAuthorizationPort,
  ScanRunTransition,
} from './runtime/contracts.js';
import { ScanRunApplicationService } from './runtime/scan-run-application-service.js';
import { assertScanRunTransition } from './runtime/state-machine.js';

const fixedNow = new Date('2026-07-13T10:00:00.000Z');
const userId = '00000000-0000-4000-8000-000000000111';
let uuidSequence = 300;

function randomUUID(): string {
  uuidSequence += 1;
  return `00000000-0000-4000-8000-${String(uuidSequence).padStart(12, '0')}`;
}

class MemoryScanRunRepository implements ScanRunRepository {
  readonly runs = new Map<string, ScanRun>();
  readonly transitions: ScanRunTransition[] = [];

  findById(id: string): Promise<ScanRun | null> {
    return Promise.resolve(this.runs.get(id) ?? null);
  }

  findByIdempotency(
    requestedBy: string,
    idempotencyKeyHash: string,
  ): Promise<ScanRun | null> {
    return Promise.resolve(
      [...this.runs.values()].find(
        (run) =>
          run.requestedBy === requestedBy &&
          run.idempotencyKeyHash === idempotencyKeyHash,
      ) ?? null,
    );
  }

  async createIdempotently(
    input: NewScanRun,
  ): Promise<IdempotentScanRunCreation> {
    const existing = await this.findByIdempotency(
      input.requestedBy,
      input.idempotencyKeyHash,
    );
    if (existing !== null) return { run: existing, created: false };
    const run: ScanRun = {
      id: randomUUID(),
      source: input.source,
      requestedBy: input.requestedBy,
      idempotencyKeyHash: input.idempotencyKeyHash,
      requestHash: input.requestHash,
      status: 'queued',
      executionMode: input.executionPlan.executionMode,
      planVersion: input.executionPlan.planVersion,
      ruleVersion: input.executionPlan.normalizedRule.version,
      normalizedRule: input.executionPlan.normalizedRule,
      executionPlan: input.executionPlan,
      universeSnapshot: input.universeSnapshot,
      complexityScore: input.executionPlan.complexity.score,
      dataCutoffAt: input.dataCutoffAt,
      queuedAt: input.dataCutoffAt,
      cancelRequestedAt: null,
      cancelledAt: null,
    };
    this.runs.set(run.id, run);
    return { run, created: true };
  }

  transition(input: ScanRunTransition): Promise<ScanRun | null> {
    const run = this.runs.get(input.runId);
    if (run === undefined || run.status !== input.fromStatus) {
      return Promise.resolve(null);
    }
    const updated: ScanRun = {
      ...run,
      status: input.toStatus,
      cancelRequestedAt:
        input.toStatus === 'cancel_requested'
          ? input.occurredAt
          : run.cancelRequestedAt,
      cancelledAt:
        input.toStatus === 'cancelled' ? input.occurredAt : run.cancelledAt,
    };
    this.runs.set(run.id, updated);
    this.transitions.push(input);
    return Promise.resolve(updated);
  }
}

function rule(children = [...baseRule().root.children]): ScanRuleAst {
  return { ...baseRule(), root: { ...baseRule().root, children } };
}

function baseRule(): ScanRuleAst {
  return {
    version: 1,
    universe: {
      market: 'BIST',
      statuses: ['active'],
      indexCodes: ['XU100'],
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
          right: { type: 'constantNumber', value: 10 },
        },
        {
          type: 'condition',
          nodeId: 'volume',
          operator: 'GT',
          left: { type: 'volumeField', field: 'volume', timeframe: '1d' },
          right: { type: 'constantNumber', value: 100 },
        },
      ],
    },
  };
}

function setup(
  options: { allowed?: boolean; instruments?: readonly string[] } = {},
) {
  const repository = new MemoryScanRunRepository();
  const resolve = vi.fn((filter: ScanRuleAst['universe']) =>
    Promise.resolve({
      instrumentIds: options.instruments ?? [
        '00000000-0000-4000-8000-000000000201',
        '00000000-0000-4000-8000-000000000202',
      ],
      filter,
      resolvedAt: new Date('2026-07-13T09:59:00.000Z'),
    }),
  );
  const authorize = vi.fn<ScanSourceAuthorizationPort['authorize']>(() =>
    Promise.resolve(true),
  );
  const entitlementCheck = vi.fn(() => ({
    allowed: options.allowed ?? true,
  }));
  const service = new ScanRunApplicationService({
    repository,
    universeResolver: { resolve },
    sourceAuthorization: { authorize },
    planner: {
      indicatorRegistry: createCoreIndicatorRegistry(),
      entitlement: { check: entitlementCheck },
      limits: {
        maximumComplexityScore: 100_000,
        asynchronousComplexityThreshold: 10_000,
      },
    },
    now: () => new Date(fixedNow),
  });
  return { service, repository, resolve, authorize, entitlementCheck };
}

describe('ScanRunApplicationService', () => {
  it('persists a first-class run with plan, versions, snapshot and one cutoff', async () => {
    const { service, repository, entitlementCheck } = setup();
    const result = await service.create({
      userId,
      idempotencyKey: 'secret-client-key',
      rule: rule(),
    });

    expect(result.replayed).toBe(false);
    expect(repository.runs).toHaveLength(1);
    expect(result.run).toMatchObject({
      requestedBy: userId,
      status: 'queued',
      planVersion: 1,
      ruleVersion: 1,
      dataCutoffAt: fixedNow,
      universeSnapshot: {
        instrumentIds: [
          '00000000-0000-4000-8000-000000000201',
          '00000000-0000-4000-8000-000000000202',
        ],
        resolvedAt: '2026-07-13T09:59:00.000Z',
      },
    });
    expect(result.run.idempotencyKeyHash).not.toContain('secret-client-key');
    expect(result.run.executionPlan.normalizedRule).toEqual(
      result.run.normalizedRule,
    );
    expect(entitlementCheck).toHaveBeenCalledOnce();
  });

  it('returns the same run for the same key and normalized request', async () => {
    const { service, resolve, entitlementCheck } = setup();
    const first = await service.create({
      userId,
      idempotencyKey: 'same-key',
      rule: rule(),
    });
    const second = await service.create({
      userId,
      idempotencyKey: 'same-key',
      rule: rule([...baseRule().root.children].reverse()),
    });

    expect(second).toEqual({ run: first.run, replayed: true });
    expect(resolve).toHaveBeenCalledOnce();
    expect(entitlementCheck).toHaveBeenCalledOnce();
  });

  it('rejects the same idempotency key with a different request', async () => {
    const { service, repository } = setup();
    await service.create({
      userId,
      idempotencyKey: 'reused-key',
      rule: rule(),
    });
    const changed = baseRule();
    const first = changed.root.children[0];
    if (first?.type !== 'condition') throw new Error('fixture invariant');
    const changedRule = rule([
      { ...first, right: { type: 'constantNumber', value: 11 } },
      changed.root.children[1]!,
    ]);

    await expect(
      service.create({
        userId,
        idempotencyKey: 'reused-key',
        rule: changedRule,
      }),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    expect(repository.runs).toHaveLength(1);
  });

  it('enforces source authorization, entitlement and non-empty universe', async () => {
    const unauthorized = setup();
    unauthorized.authorize.mockResolvedValue(false);
    await expect(
      unauthorized.service.create({
        userId,
        idempotencyKey: 'source-denied',
        source: { type: 'saved_scan', id: randomUUID(), revision: 1 },
        rule: rule(),
      }),
    ).rejects.toMatchObject({ code: 'SCAN_SOURCE_ACCESS_DENIED' });

    await expect(
      setup({ allowed: false }).service.create({
        userId,
        idempotencyKey: 'plan-denied',
        rule: rule(),
      }),
    ).rejects.toMatchObject({ code: 'SCAN_ENTITLEMENT_VIOLATION' });

    await expect(
      setup({ instruments: [] }).service.create({
        userId,
        idempotencyKey: 'empty',
        rule: rule(),
      }),
    ).rejects.toMatchObject({ code: 'SCAN_UNIVERSE_EMPTY' });
  });

  it('does not start a run from a deleted saved scan', async () => {
    const runtime = setup();
    runtime.authorize.mockResolvedValue({
      allowed: false,
      errorCode: 'SAVED_SCAN_DELETED',
    });

    await expect(
      runtime.service.create({
        userId,
        idempotencyKey: 'deleted-saved-scan',
        source: { type: 'saved_scan', id: randomUUID(), revision: 1 },
        rule: rule(),
      }),
    ).rejects.toMatchObject({ code: 'SAVED_SCAN_DELETED' });
    expect(runtime.repository.runs).toHaveLength(0);
  });

  it('persists the exact preset source revision on a run', async () => {
    const runtime = setup();
    const presetId = randomUUID();
    const created = await runtime.service.create({
      userId,
      idempotencyKey: 'preset-revision',
      source: { type: 'preset_scan', id: presetId, revision: 3 },
      rule: rule(),
    });

    expect(created.run.source).toEqual({
      type: 'preset_scan',
      id: presetId,
      revision: 3,
    });
    expect(runtime.repository.runs.get(created.run.id)?.source.revision).toBe(
      3,
    );
  });

  it('enforces owner-only read and cooperative idempotent cancellation', async () => {
    const { service, repository } = setup();
    const created = await service.create({
      userId,
      idempotencyKey: 'cancel',
      rule: rule(),
    });
    await expect(
      service.getOwned(created.run.id, randomUUID()),
    ).rejects.toMatchObject({
      code: 'SCAN_RUN_ACCESS_DENIED',
    });

    const requested = await service.requestCancellation(created.run.id, userId);
    const replayed = await service.requestCancellation(created.run.id, userId);
    expect(requested.status).toBe('cancel_requested');
    expect(replayed).toEqual(requested);
    expect(repository.transitions).toHaveLength(1);

    const cancelled = await service.transitionStatus(
      created.run.id,
      'cancelled',
    );
    expect(cancelled.status).toBe('cancelled');
    await expect(
      service.requestCancellation(created.run.id, userId),
    ).rejects.toMatchObject({ code: 'SCAN_RUN_NOT_CANCELLABLE' });
  });

  it('rejects missing keys, invalid rules, unknown runs and invalid transitions', async () => {
    const { service } = setup();
    await expect(
      service.create({ userId, idempotencyKey: ' ', rule: rule() }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    await expect(
      service.create({ userId, idempotencyKey: 'invalid', rule: {} }),
    ).rejects.toMatchObject({ code: 'SCAN_RULE_INVALID' });
    await expect(service.getOwned(randomUUID(), userId)).rejects.toMatchObject({
      code: 'SCAN_RUN_NOT_FOUND',
    });

    const created = await service.create({
      userId,
      idempotencyKey: 'transition',
      rule: rule(),
    });
    await expect(
      service.transitionStatus(created.run.id, 'completed'),
    ).rejects.toMatchObject({ code: 'SCAN_RUN_INVALID_TRANSITION' });
  });
});

describe('scan run state machine', () => {
  it.each([
    ['queued', 'running'],
    ['queued', 'failed'],
    ['queued', 'cancel_requested'],
    ['running', 'completed'],
    ['running', 'failed'],
    ['running', 'cancel_requested'],
    ['cancel_requested', 'cancelled'],
    ['cancel_requested', 'failed'],
    ['completed', 'expired'],
    ['failed', 'expired'],
    ['cancelled', 'expired'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(() => assertScanRunTransition(from, to)).not.toThrow();
  });

  it.each([
    ['queued', 'completed'],
    ['running', 'queued'],
    ['completed', 'running'],
    ['failed', 'running'],
    ['cancelled', 'running'],
    ['expired', 'queued'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(() => assertScanRunTransition(from, to)).toThrowError(
      expect.objectContaining({ code: 'SCAN_RUN_INVALID_TRANSITION' }),
    );
  });
});
