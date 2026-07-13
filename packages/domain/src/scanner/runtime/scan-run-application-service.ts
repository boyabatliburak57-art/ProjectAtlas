import { planScanExecution } from '../planning/execution-planner.js';
import { validateScanRule } from '../validation/scan-rule-validator.js';

import type {
  CreateScanRunRequest,
  CreateScanRunResult,
  ScanRun,
  ScanRunApplicationDependencies,
  ScanRunSource,
  ScanRunStatus,
} from './contracts.js';
import { ScanRunApplicationError } from './errors.js';
import { hashIdempotencyKey, hashNormalizedScanRunRequest } from './hashing.js';
import {
  assertScanRunTransition,
  isTerminalScanRunStatus,
} from './state-machine.js';

const defaultSource: ScanRunSource = { type: 'ad_hoc' };

export class ScanRunApplicationService {
  private readonly now: () => Date;

  constructor(private readonly dependencies: ScanRunApplicationDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async create(request: CreateScanRunRequest): Promise<CreateScanRunResult> {
    if (request.idempotencyKey.trim().length === 0) {
      throw new ScanRunApplicationError('IDEMPOTENCY_KEY_REQUIRED');
    }
    const source = request.source ?? defaultSource;
    const authorization = await this.dependencies.sourceAuthorization.authorize(
      {
        userId: request.userId,
        source,
      },
    );
    const authorized =
      typeof authorization === 'boolean'
        ? authorization
        : authorization.allowed;
    if (!authorized) {
      if (
        typeof authorization !== 'boolean' &&
        authorization.errorCode !== undefined
      ) {
        throw new ScanRunApplicationError(authorization.errorCode);
      }
      throw new ScanRunApplicationError('SCAN_SOURCE_ACCESS_DENIED');
    }

    const validation = validateScanRule(request.rule);
    if (!validation.valid || validation.normalizedRule === undefined) {
      throw new ScanRunApplicationError('SCAN_RULE_INVALID', {
        validationErrors: validation.errors,
      });
    }
    const requestedHistoryBars = request.requestedHistoryBars ?? 1;
    const requestHash = hashNormalizedScanRunRequest({
      source,
      normalizedRule: validation.normalizedRule,
      requestedHistoryBars,
    });
    const idempotencyKeyHash = hashIdempotencyKey(request.idempotencyKey);
    const existing = await this.dependencies.repository.findByIdempotency(
      request.userId,
      idempotencyKeyHash,
    );
    if (existing !== null) {
      return replay(existing, requestHash);
    }

    const universe = await this.dependencies.universeResolver.resolve(
      validation.normalizedRule.universe,
    );
    if (universe.instrumentIds.length === 0) {
      throw new ScanRunApplicationError('SCAN_UNIVERSE_EMPTY');
    }
    const plan = planScanExecution(
      {
        rule: validation.normalizedRule,
        universeInstrumentCount: universe.instrumentIds.length,
        requestedHistoryBars,
      },
      this.dependencies.planner,
    );
    const dataCutoffAt = this.now();
    const creation = await this.dependencies.repository.createIdempotently({
      source,
      requestedBy: request.userId,
      idempotencyKeyHash,
      requestHash,
      executionPlan: plan,
      universeSnapshot: {
        instrumentIds: [...universe.instrumentIds],
        filter: plan.universe.filter,
        resolvedAt: universe.resolvedAt.toISOString(),
      },
      dataCutoffAt,
    });
    if (!creation.created) return replay(creation.run, requestHash);
    return { run: creation.run, replayed: false };
  }

  async getOwned(runId: string, userId: string): Promise<ScanRun> {
    const run = await this.requireRun(runId);
    if (run.requestedBy !== userId) {
      throw new ScanRunApplicationError('SCAN_RUN_ACCESS_DENIED');
    }
    return run;
  }

  async requestCancellation(runId: string, userId: string): Promise<ScanRun> {
    const run = await this.getOwned(runId, userId);
    if (run.status === 'cancel_requested') return run;
    if (isTerminalScanRunStatus(run.status)) {
      throw new ScanRunApplicationError('SCAN_RUN_NOT_CANCELLABLE');
    }
    return this.transition(run, 'cancel_requested', userId);
  }

  async transitionStatus(
    runId: string,
    toStatus: ScanRunStatus,
    options: {
      readonly actorUserId?: string | undefined;
      readonly errorCode?: string | undefined;
    } = {},
  ): Promise<ScanRun> {
    const run = await this.requireRun(runId);
    return this.transition(
      run,
      toStatus,
      options.actorUserId,
      options.errorCode,
    );
  }

  private async transition(
    run: ScanRun,
    toStatus: ScanRunStatus,
    actorUserId?: string,
    errorCode?: string,
  ): Promise<ScanRun> {
    assertScanRunTransition(run.status, toStatus);
    const transitioned = await this.dependencies.repository.transition({
      runId: run.id,
      fromStatus: run.status,
      toStatus,
      occurredAt: this.now(),
      ...(actorUserId === undefined ? {} : { actorUserId }),
      ...(errorCode === undefined ? {} : { errorCode }),
    });
    if (transitioned === null) {
      const current = await this.requireRun(run.id);
      throw new ScanRunApplicationError('SCAN_RUN_INVALID_TRANSITION', {
        fromStatus: current.status,
        toStatus,
      });
    }
    return transitioned;
  }

  private async requireRun(runId: string): Promise<ScanRun> {
    const run = await this.dependencies.repository.findById(runId);
    if (run === null) throw new ScanRunApplicationError('SCAN_RUN_NOT_FOUND');
    return run;
  }
}

function replay(run: ScanRun, requestHash: string): CreateScanRunResult {
  if (run.requestHash !== requestHash) {
    throw new ScanRunApplicationError('IDEMPOTENCY_KEY_REUSED');
  }
  return { run, replayed: true };
}
