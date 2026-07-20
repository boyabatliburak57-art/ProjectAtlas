import type {
  BacktestRunRecord,
  BacktestRunRepository,
  StrategyRepository,
} from '@atlas/domain';

export const STRATEGY_REPOSITORY = Symbol('STRATEGY_REPOSITORY');
export const BACKTEST_RUN_REPOSITORY = Symbol('BACKTEST_RUN_REPOSITORY');
export const BACKTEST_ANALYTICS_STORE = Symbol('BACKTEST_ANALYTICS_STORE');
export const EXPERIMENT_STORE = Symbol('EXPERIMENT_STORE');
export const BACKTEST_COMMAND_GUARD = Symbol('BACKTEST_COMMAND_GUARD');

export interface StrategyApiRepository extends StrategyRepository {
  listOwned(
    userId: string,
    includeDeleted: boolean,
  ): Promise<readonly import('@atlas/domain').StrategyWithRevision[]>;
  setDeleted(input: {
    readonly id: string;
    readonly userId: string;
    readonly deleted: boolean;
    readonly now: Date;
  }): Promise<import('@atlas/domain').StrategyWithRevision | null>;
}

export interface BacktestRunPage {
  readonly items: readonly BacktestRunRecord[];
  readonly nextCursor: string | null;
}

export interface BacktestTradeCursorPosition {
  readonly closedAt: Date;
  readonly tradeSequence: number;
  readonly id: string;
}

export interface BacktestAnalyticsStore {
  listRuns(input: {
    readonly userId: string;
    readonly limit: number;
    readonly cursor: { readonly updatedAt: Date; readonly id: string } | null;
    readonly status?: string | undefined;
  }): Promise<{
    readonly items: readonly BacktestRunRecord[];
    readonly nextPosition: {
      readonly updatedAt: Date;
      readonly id: string;
    } | null;
  }>;
  summary(runId: string): Promise<Record<string, unknown> | null>;
  series(input: {
    readonly runId: string;
    readonly type: string;
    readonly from: Date | null;
    readonly to: Date | null;
    readonly maximumPoints: number;
  }): Promise<readonly Record<string, unknown>[]>;
  trades(input: {
    readonly runId: string;
    readonly limit: number;
    readonly instrumentId: string | null;
    readonly cursor: BacktestTradeCursorPosition | null;
  }): Promise<{
    readonly items: readonly Record<string, unknown>[];
    readonly nextPosition: BacktestTradeCursorPosition | null;
  }>;
  orders(
    runId: string,
    limit: number,
  ): Promise<readonly Record<string, unknown>[]>;
  fills(
    runId: string,
    limit: number,
  ): Promise<readonly Record<string, unknown>[]>;
  methodology(runId: string): Promise<Record<string, unknown> | null>;
}

export interface ExperimentRecord {
  readonly id: string;
  readonly ownerUserId: string;
  readonly strategyId: string;
  readonly strategyRevision: number;
  readonly name: string;
  readonly status: string;
  readonly definition: Readonly<Record<string, unknown>>;
  readonly combinationCount: number;
  readonly completedRunCount: number;
  readonly failedRunCount: number;
  readonly warnings: readonly Record<string, unknown>[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ExperimentStore {
  listOwned(userId: string): Promise<readonly ExperimentRecord[]>;
  findById(id: string): Promise<ExperimentRecord | null>;
  create(input: {
    readonly id: string;
    readonly ownerUserId: string;
    readonly strategyId: string;
    readonly strategyRevision: number;
    readonly dataSnapshotId: string;
    readonly dataSnapshotHash: string;
    readonly name: string;
    readonly experimentHash: string;
    readonly definition: Readonly<Record<string, unknown>>;
    readonly combinationCount: number;
    readonly now: Date;
  }): Promise<ExperimentRecord>;
  cancel(
    id: string,
    userId: string,
    now: Date,
  ): Promise<ExperimentRecord | null>;
  results(id: string): Promise<readonly Record<string, unknown>[]>;
  matrix(id: string): Promise<readonly Record<string, unknown>[]>;
}

export interface BacktestCommandGuard {
  consume(input: {
    readonly userId: string;
    readonly operation: 'run' | 'experiment' | 'export';
    readonly complexity: number;
    readonly now: Date;
  }): void;
}

export type BacktestRunCommands = BacktestRunRepository;
