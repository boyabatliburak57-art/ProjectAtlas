import type { StructuredLogger } from '../observability/structured-logger';
import type {
  AlertEvaluationEvent,
  AlertEvaluationPersistenceInput,
  AlertEvaluationRepository,
  AlertMetrics,
  PersistEvaluationResult,
  AlertSourceEvaluator,
  AlertTriggerSink,
} from './contracts';

export class AlertEvaluationProcessor {
  constructor(
    private readonly dependencies: {
      readonly repository: AlertEvaluationRepository;
      readonly evaluator: AlertSourceEvaluator;
      readonly metrics: AlertMetrics;
      readonly logger: StructuredLogger;
      readonly triggerSink?: AlertTriggerSink | undefined;
      readonly now?: (() => Date) | undefined;
    },
  ) {}

  async process(event: AlertEvaluationEvent): Promise<{
    readonly candidateCount: number;
    readonly triggerCount: number;
    readonly duplicateCount: number;
  }> {
    const startedAt = Date.now();
    const candidates = await this.dependencies.repository.findCandidates(event);
    let triggerCount = 0;
    let duplicateCount = 0;
    const inputs: AlertEvaluationPersistenceInput[] = [];
    for (const candidate of candidates) {
      const evaluationStartedAt = Date.now();
      const evaluation = await this.dependencies.evaluator.evaluate(
        candidate,
        event,
      );
      const evaluatedAt = this.dependencies.now?.() ?? new Date();
      inputs.push({
        candidate,
        event,
        evaluation,
        evaluatedAt,
        durationMs: Math.max(0, Date.now() - evaluationStartedAt),
      });
    }
    const persistedResults = this.dependencies.repository.persistEvaluations
      ? await this.dependencies.repository.persistEvaluations(inputs)
      : await persistIndividually(this.dependencies.repository, inputs);
    if (persistedResults.length !== inputs.length) {
      throw new Error('ALERT_EVALUATION_PERSISTENCE_RESULT_MISMATCH');
    }
    for (const [index, input] of inputs.entries()) {
      const persisted = persistedResults[index]!;
      triggerCount += persisted.triggerCount;
      duplicateCount += persisted.duplicate ? 1 : 0;
      this.dependencies.metrics.increment('alert.evaluation.count', 1, {
        status: input.evaluation.status,
      });
      if (input.evaluation.status === 'not_evaluable') {
        this.dependencies.metrics.increment('alert.evaluation.not_evaluable');
      }
      if (persisted.triggerIds.length > 0) {
        await this.dependencies.triggerSink?.handle(persisted.triggerIds);
      }
    }
    this.dependencies.metrics.increment('alert.trigger.count', triggerCount);
    this.dependencies.metrics.increment(
      'alert.evaluation.dedup',
      duplicateCount,
    );
    this.dependencies.metrics.observe(
      'alert.evaluation.duration_ms',
      Math.max(0, Date.now() - startedAt),
    );
    this.dependencies.logger.info('worker.alert.evaluation.completed', {
      candidateCount: candidates.length,
      duplicateCount,
      eventId: event.eventId,
      eventType: event.type,
      triggerCount,
    });
    return { candidateCount: candidates.length, triggerCount, duplicateCount };
  }
}

async function persistIndividually(
  repository: AlertEvaluationRepository,
  inputs: readonly AlertEvaluationPersistenceInput[],
) {
  const results: PersistEvaluationResult[] = [];
  for (const input of inputs) {
    results.push(await repository.persistEvaluation(input));
  }
  return results;
}
