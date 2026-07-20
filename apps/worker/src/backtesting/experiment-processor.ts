import {
  BacktestRuntimeApplicationError,
  createExperimentChildBindings,
  generateExperimentCombinations,
  type ExperimentChildRunPort,
} from '@atlas/domain';
import type { Job } from 'bullmq';

import type { StructuredLogger } from '../observability/structured-logger';
import type {
  ExperimentJobData,
  ExperimentRuntimeMetrics,
} from './experiment-contracts';
import { ExperimentProductionRepository } from './experiment-production-repository';
import { PostgresExperimentRuntimeRepository } from './postgres-experiment-runtime-repository';

export interface ExperimentProcessorDependencies {
  readonly productionRepository: ExperimentProductionRepository;
  readonly runtimeRepository: PostgresExperimentRuntimeRepository;
  readonly childRuns: ExperimentChildRunPort;
  readonly metrics: ExperimentRuntimeMetrics;
  readonly logger: StructuredLogger;
  readonly timeoutMs: number;
  readonly pollIntervalMs?: number;
}

export class ExperimentProcessor {
  constructor(private readonly dependencies: ExperimentProcessorDependencies) {}

  async process(job: Job<ExperimentJobData>): Promise<unknown> {
    const startedAt = Date.now();
    const authoritative =
      await this.dependencies.productionRepository.loadAuthoritative(
        job.data.experimentId,
      );
    if (authoritative === null) throw new Error('EXPERIMENT_NOT_FOUND');
    if (
      ['completed', 'partial', 'failed', 'cancelled'].includes(
        authoritative.status,
      )
    ) {
      this.dependencies.metrics.increment('experiment.terminal.replay');
      return { status: authoritative.status, replayed: true };
    }
    const claimed = await this.dependencies.productionRepository.claim(
      authoritative.runtime.id,
    );
    if (!claimed && authoritative.status !== 'cancel_requested')
      return { status: authoritative.status, replayed: true };

    const fields = {
      correlationId: authoritative.runtime.id,
      experimentId: authoritative.runtime.id,
      jobId: job.id,
      userId: authoritative.runtime.ownerUserId,
    };
    this.dependencies.logger.info('worker.experiment.started', fields);
    this.dependencies.metrics.increment('experiment.started');
    const combinations = generateExperimentCombinations(
      authoritative.definition,
    );
    const children = createExperimentChildBindings(
      combinations,
      authoritative.definition.grid.samples,
    );
    let provisioningFailures = 0;
    let skippedCount = 0;
    let createdCount = 0;
    let reusedCount = 0;

    const initiallyCancelled =
      await this.dependencies.runtimeRepository.isCancellationRequested(
        authoritative.runtime.id,
      );
    const reusable = initiallyCancelled
      ? new Map<string, string>()
      : await this.dependencies.productionRepository.findReusableCompletedRuns({
          ownerUserId: authoritative.runtime.ownerUserId,
          strategyId: authoritative.runtime.strategyId,
          strategyRevision: authoritative.runtime.strategyRevision,
          dataSnapshotHash: authoritative.runtime.dataSnapshotHash,
          engineVersion: 'backtest-engine-v1',
          executionPolicyVersion:
            authoritative.strategyDefinition.executionPolicy.version,
          costPolicyVersion:
            authoritative.strategyDefinition.costPolicy.version,
          eventOrderingPolicyVersion: 'deterministic-event-ordering-v1',
          children,
        });
    const reusableChildren = children.flatMap((child) => {
      const runId = reusable.get(child.bindingHash);
      return runId === undefined ? [] : [{ child, runId }];
    });
    if (initiallyCancelled) skippedCount = children.length;
    else
      reusedCount =
        await this.dependencies.productionRepository.attachReusableChildren({
          experimentId: authoritative.runtime.id,
          ownerUserId: authoritative.runtime.ownerUserId,
          children: reusableChildren,
        });

    for (const [childIndex, child] of children.entries()) {
      if (initiallyCancelled) break;
      if (
        await this.dependencies.runtimeRepository.isCancellationRequested(
          authoritative.runtime.id,
        )
      ) {
        skippedCount = children.length - childIndex;
        break;
      }
      if (reusable.has(child.bindingHash)) continue;
      try {
        const run = await this.dependencies.childRuns.create({
          experiment: authoritative.runtime,
          child,
        });
        const attached = await this.dependencies.runtimeRepository.attachChild({
          experimentId: authoritative.runtime.id,
          ownerUserId: authoritative.runtime.ownerUserId,
          child,
          runId: run.runId,
          status: 'queued',
        });
        if (attached === 'created') createdCount += 1;
      } catch (error: unknown) {
        if (!(error instanceof BacktestRuntimeApplicationError)) throw error;
        provisioningFailures += 1;
        await this.dependencies.runtimeRepository.markChildFailed({
          experimentId: authoritative.runtime.id,
          child,
          errorCode: error.code,
        });
      }
      await job.updateProgress({
        phase: 'provisioning',
        completed: createdCount + reusedCount + provisioningFailures,
        total: children.length,
      });
    }

    for (;;) {
      const cancellationRequested =
        await this.dependencies.runtimeRepository.isCancellationRequested(
          authoritative.runtime.id,
        );
      if (cancellationRequested)
        await this.cancelRunning(
          authoritative.runtime.id,
          authoritative.runtime.ownerUserId,
        );
      const aggregate = await this.dependencies.productionRepository.aggregate(
        authoritative.runtime.id,
        children.length,
        provisioningFailures,
        skippedCount,
      );
      await job.updateProgress({
        phase: aggregate.terminal ? 'terminal' : 'aggregating',
        completed:
          aggregate.completedCount +
          aggregate.failedCount +
          aggregate.cancelledCount,
        total: children.length,
      });
      if (aggregate.terminal) {
        const duration = Date.now() - startedAt;
        this.dependencies.metrics.increment(`experiment.${aggregate.status}`);
        this.dependencies.metrics.observe('experiment.duration.ms', duration);
        this.dependencies.logger.info('worker.experiment.terminal', {
          ...fields,
          cancelledCount: aggregate.cancelledCount,
          completedCount: aggregate.completedCount,
          durationMs: duration,
          failedCount: aggregate.failedCount,
          reusedCount: aggregate.reusedCount,
          status: aggregate.status,
        });
        return aggregate;
      }
      if (Date.now() - startedAt >= this.dependencies.timeoutMs)
        throw new Error('EXPERIMENT_ORCHESTRATION_TIMEOUT');
      await delay(this.dependencies.pollIntervalMs ?? 50);
    }
  }

  private async cancelRunning(experimentId: string, userId: string) {
    const runIds =
      await this.dependencies.runtimeRepository.listRunningChildRunIds(
        experimentId,
      );
    for (const runId of runIds)
      try {
        await this.dependencies.childRuns.requestCancellation(runId, userId);
      } catch (error: unknown) {
        if (
          !(error instanceof BacktestRuntimeApplicationError) ||
          error.code !== 'BACKTEST_RUN_NOT_CANCELLABLE'
        )
          throw error;
      }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
