import type {
  AlertEvaluationMode,
  AlertRepeatPolicy,
  AlertSource,
  AlertState,
  AlertTriggerPolicy,
} from '@atlas/domain';
import type {
  AlertEvaluationQueuePayload,
  SafeTraceContext,
} from '@atlas/types';

export type AlertEvaluationEvent = AlertEvaluationQueuePayload;

export interface AlertCandidate {
  readonly alertId: string;
  readonly alertRevision: number;
  readonly ownerUserId: string;
  readonly source: AlertSource;
  readonly triggerPolicy: AlertTriggerPolicy;
  readonly repeatPolicy: AlertRepeatPolicy;
  readonly timeframe: string | null;
  readonly evaluationMode: AlertEvaluationMode;
  readonly sourceConfiguration: Readonly<Record<string, unknown>>;
}

export interface AlertSourceEvaluation {
  readonly status: 'matched' | 'not_matched' | 'not_evaluable';
  readonly reasonCode: string | null;
  readonly matchedInstrumentIds: readonly string[];
  readonly result: Readonly<Record<string, unknown>>;
}

export interface PersistEvaluationResult {
  readonly duplicate: boolean;
  readonly triggerCount: number;
  readonly triggerIds: readonly string[];
  readonly state: AlertState | null;
}

export interface AlertEvaluationPersistenceInput {
  readonly candidate: AlertCandidate;
  readonly event: AlertEvaluationEvent;
  readonly evaluation: AlertSourceEvaluation;
  readonly evaluatedAt: Date;
  readonly durationMs: number;
}

export interface AlertTriggerSink {
  handle(
    triggerIds: readonly string[],
    telemetry?: SafeTraceContext,
  ): Promise<void>;
}

export interface AlertEvaluationRepository {
  findCandidates(
    event: AlertEvaluationEvent,
  ): Promise<readonly AlertCandidate[]>;
  persistEvaluation(
    input: AlertEvaluationPersistenceInput,
  ): Promise<PersistEvaluationResult>;
  persistEvaluations?(
    inputs: readonly AlertEvaluationPersistenceInput[],
  ): Promise<readonly PersistEvaluationResult[]>;
  listCatchUpEvents(limit: number): Promise<readonly AlertEvaluationEvent[]>;
}

export interface AlertSourceEvaluator {
  evaluate(
    candidate: AlertCandidate,
    event: AlertEvaluationEvent,
  ): Promise<AlertSourceEvaluation>;
}

export interface AlertMetrics {
  increment(
    name: string,
    value?: number,
    tags?: Readonly<Record<string, string>>,
  ): void;
  observe(
    name: string,
    value: number,
    tags?: Readonly<Record<string, string>>,
  ): void;
}
