import { randomUUID } from 'node:crypto';

import {
  backtestDataSnapshots,
  backtestRuns,
  createDatabase,
  researchExperiments,
  runMigrations,
  strategies,
  strategyRevisions,
} from '@atlas/database';
import {
  createExperimentChildBindings,
  generateExperimentCombinations,
  ResearchExperimentRuntimeService,
  type ExperimentChildBinding,
  type ExperimentDefinitionInput,
  type ExperimentRuntimeRecord,
} from '@atlas/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PostgresExperimentRuntimeRepository } from './postgres-experiment-runtime-repository';

function requireTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (
    value === undefined ||
    !new URL(value).pathname.slice(1).endsWith('_test')
  )
    throw new Error('TEST_DATABASE_URL with an _test database is required');
  return value;
}

const ownerUserId = '00000000-0000-4000-8000-000000000681';
const strategyId = '00000000-0000-4000-8000-000000000682';
const snapshotId = '00000000-0000-4000-8000-000000000683';
const snapshotHash = 'snapshot-067-experiment';

describe('research experiment PostgreSQL runtime', () => {
  const { db, pool } = createDatabase(requireTestDatabaseUrl());
  const repository = new PostgresExperimentRuntimeRepository(db);

  beforeAll(async () => {
    await pool.query('drop schema if exists public cascade');
    await pool.query('drop schema if exists drizzle cascade');
    await pool.query('create schema public');
    await runMigrations(db);
    await db.insert(strategies).values({
      id: strategyId,
      ownerUserId,
      name: 'Experiment Strategy',
      status: 'validated',
      currentRevision: 1,
    });
    await db.insert(strategyRevisions).values({
      strategyId,
      revision: 1,
      schemaVersion: 1,
      definition: { fixture: true },
      validationStatus: 'valid',
      complexityScore: 10,
      createdBy: ownerUserId,
    });
    await db.insert(backtestDataSnapshots).values({
      id: snapshotId,
      snapshotHash,
      schemaVersion: 1,
      marketRevisionHash: 'market-r1',
      universeRevisionHash: 'universe-r1',
      fundamentalRevisionHash: 'fundamental-r1',
      corporateActionRevisionHash: 'action-r1',
      dataCutoffAt: new Date('2024-12-31T15:00:00.000Z'),
      coverageStatus: 'complete',
    });
  });

  afterAll(async () => pool.end());

  it('11. generates the bounded grid in deterministic order and count', () => {
    const left = generateExperimentCombinations(definition());
    const right = generateExperimentCombinations(definition());
    expect(left).toHaveLength(4);
    expect(left).toEqual(right);
    expect(left.map((item) => item.values)).toEqual([
      { period: 10, threshold: 1 },
      { period: 10, threshold: 2 },
      { period: 20, threshold: 1 },
      { period: 20, threshold: 2 },
    ]);
  });

  it('12. rejects a duplicate experiment binding in PostgreSQL', async () => {
    const experiment = await insertExperiment(1);
    const child = children(definition())[0]!;
    const runId = await insertChildRun(child);
    expect(
      await repository.attachChild({
        experimentId: experiment.id,
        ownerUserId,
        child,
        runId,
        status: 'queued',
      }),
    ).toBe('created');
    expect(
      await repository.attachChild({
        experimentId: experiment.id,
        ownerUserId,
        child,
        runId,
        status: 'queued',
      }),
    ).toBe('duplicate');
  });

  it('13. reuses a completed run only with the same snapshot and policy versions', async () => {
    const child = children(definition())[0]!;
    const runId = await insertChildRun(child, 'completed');
    const compatible = compatibility(child);
    expect(await repository.findReusableCompletedRun(compatible)).toEqual({
      runId,
    });
    expect(
      await repository.findReusableCompletedRun({
        ...compatible,
        costPolicyVersion: 'different-cost-v2',
      }),
    ).toBeNull();
  });

  it('14. persists partial experiment completion when a child fails', async () => {
    const experiment = await insertExperiment(4);
    let call = 0;
    const runtime = new ResearchExperimentRuntimeService(repository, {
      async create({ child }) {
        call += 1;
        if (call === 2) throw new Error('synthetic child failure');
        return { runId: await insertChildRun(child) };
      },
      requestCancellation: vi.fn(),
    });
    const result = await runtime.orchestrate(orchestration(experiment));
    expect(result).toMatchObject({ status: 'partial', failedCount: 1 });
    const rows = await db
      .select()
      .from(researchExperiments)
      .where(eq(researchExperiments.id, experiment.id));
    expect(rows[0]).toMatchObject({ status: 'partial', failedRunCount: 1 });
  });

  it('15. propagates experiment cancellation to running children', async () => {
    const experiment = await insertExperiment(1, 'cancel_requested');
    const child = children(definition())[0]!;
    const runId = await insertChildRun(child);
    await repository.attachChild({
      experimentId: experiment.id,
      ownerUserId,
      child,
      runId,
      status: 'queued',
    });
    const cancel = vi.fn<(runId: string, userId: string) => Promise<void>>(() =>
      Promise.resolve(),
    );
    const runtime = new ResearchExperimentRuntimeService(repository, {
      create: vi.fn(),
      requestCancellation: cancel,
    });
    expect((await runtime.orchestrate(orchestration(experiment))).status).toBe(
      'cancelled',
    );
    expect(cancel).toHaveBeenCalledWith(runId, ownerUserId);
  });

  it('16. keeps holdout child ranges separated from in-sample inputs', async () => {
    const holdoutDefinition = definition(true);
    const bindings = children(holdoutDefinition);
    const experiment = await insertExperiment(bindings.length);
    const observed: ExperimentChildBinding[] = [];
    const runtime = new ResearchExperimentRuntimeService(repository, {
      async create({ child }) {
        observed.push(child);
        return { runId: await insertChildRun(child) };
      },
      requestCancellation: vi.fn(),
    });
    await runtime.orchestrate({
      ...orchestration(experiment, holdoutDefinition),
      engineVersion: 'engine-holdout-isolation-v1',
    });
    const train = observed.filter((child) => child.sampleRole === 'train');
    const holdout = observed.filter((child) => child.sampleRole === 'holdout');
    expect(train).toHaveLength(4);
    expect(holdout).toHaveLength(4);
    expect(
      train.every((sample) =>
        holdout.every(
          (future) => Date.parse(sample.rangeTo) < Date.parse(future.rangeFrom),
        ),
      ),
    ).toBe(true);
  });

  async function insertExperiment(
    combinationCount: number,
    status: 'running' | 'cancel_requested' = 'running',
  ): Promise<ExperimentRuntimeRecord> {
    const id = randomUUID();
    await db.insert(researchExperiments).values({
      id,
      ownerUserId,
      strategyId,
      strategyRevision: 1,
      dataSnapshotId: snapshotId,
      name: `Experiment ${id}`,
      status,
      experimentHash: randomUUID(),
      definition: { fixture: true },
      combinationCount,
    });
    return {
      id,
      ownerUserId,
      status: status === 'cancel_requested' ? 'cancelRequested' : 'running',
      strategyId,
      strategyRevision: 1,
      dataSnapshotHash: snapshotHash,
    };
  }

  async function insertChildRun(
    child: ExperimentChildBinding,
    status: 'queued' | 'completed' = 'queued',
  ): Promise<string> {
    const id = randomUUID();
    await db.insert(backtestRuns).values({
      id,
      strategyId,
      strategyRevision: 1,
      requestedBy: ownerUserId,
      status,
      requestHash: randomUUID(),
      idempotencyKeyHash: randomUUID(),
      engineVersion: 'engine-v1',
      executionPolicyVersion: 'next-open-v1',
      costPolicyVersion: 'cost-v1',
      metricPolicyVersion: 'metrics-v1',
      eventOrderingPolicyVersion: 'ordering-v1',
      roundingPolicyVersion: 'rounding-v1',
      dataSnapshotId: snapshotId,
      parameters: { experimentBindingHash: child.bindingHash },
      universeSnapshot: { version: 'history-v1' },
      timeframe: '1d',
      adjustmentMode: 'raw',
      rangeFrom: new Date(child.rangeFrom),
      rangeTo: new Date(child.rangeTo),
      initialCapital: '1000',
      ...(status === 'completed'
        ? { completedAt: new Date('2024-01-02T00:00:00.000Z'), progress: '100' }
        : {}),
    });
    return id;
  }
});

function definition(withHoldout = false): ExperimentDefinitionInput {
  return {
    parameterDefinitions: [
      {
        name: 'period',
        type: 'integer',
        defaultValue: 10,
        minimum: 5,
        maximum: 50,
      },
      {
        name: 'threshold',
        type: 'number',
        defaultValue: 1,
        minimum: 0,
        maximum: 5,
      },
    ],
    grid: {
      axes: [
        { parameter: 'threshold', values: [2, 1] },
        { parameter: 'period', values: [20, 10] },
      ],
      samples: [
        {
          role: 'train',
          from: '2020-01-01T00:00:00.000Z',
          to: '2022-12-31T23:59:59.999Z',
        },
        ...(withHoldout
          ? [
              {
                role: 'holdout' as const,
                from: '2023-01-01T00:00:00.000Z',
                to: '2024-12-31T23:59:59.999Z',
              },
            ]
          : []),
      ],
      maximumCombinations: 10,
    },
  };
}

function children(
  input: ExperimentDefinitionInput,
): readonly ExperimentChildBinding[] {
  return createExperimentChildBindings(
    generateExperimentCombinations(input),
    input.grid.samples,
  );
}

function orchestration(
  experiment: ExperimentRuntimeRecord,
  input = definition(),
) {
  return {
    experiment,
    definition: input,
    engineVersion: 'engine-v1',
    executionPolicyVersion: 'next-open-v1',
    costPolicyVersion: 'cost-v1',
    eventOrderingPolicyVersion: 'ordering-v1',
  };
}

function compatibility(child: ExperimentChildBinding) {
  return {
    ownerUserId,
    strategyId,
    strategyRevision: 1,
    bindingHash: child.bindingHash,
    dataSnapshotHash: snapshotHash,
    engineVersion: 'engine-v1',
    executionPolicyVersion: 'next-open-v1',
    costPolicyVersion: 'cost-v1',
    eventOrderingPolicyVersion: 'ordering-v1',
    rangeFrom: child.rangeFrom,
    rangeTo: child.rangeTo,
  };
}
