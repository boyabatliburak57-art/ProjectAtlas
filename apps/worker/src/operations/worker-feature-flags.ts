import { createDatabase } from '@atlas/database';
import {
  FeatureFlagEvaluator,
  type FeatureFlagCache,
  type FeatureFlagSnapshot,
  type FeatureFlagStore,
  type FeatureFlagType,
} from '@atlas/domain';
import Redis from 'ioredis';

import type { WorkerEnvironment } from '../config/environment';

export const WORKER_KILL_SWITCHES = {
  alertEvaluation: 'alerts.evaluation.disabled',
  emailDelivery: 'notifications.email-delivery.disabled',
  fundamentalsRefresh: 'fundamentals.refresh.disabled',
  patternRefresh: 'patterns.refresh.disabled',
} as const;

class WorkerFlagStore implements FeatureFlagStore {
  constructor(
    private readonly pool: ReturnType<typeof createDatabase>['pool'],
  ) {}
  async load(
    key: string,
    environment: string,
  ): Promise<FeatureFlagSnapshot | null> {
    const result = await this.pool.query<{
      default_enabled: boolean;
      enabled: boolean;
      environment: string;
      expires_at: Date | null;
      flag_type: FeatureFlagType;
      key: string;
      rollout_percentage: string | null;
      targeting_rules: Readonly<Record<string, readonly string[]>>;
      version: number;
    }>(
      `select f.key, f.flag_type, f.default_enabled, f.expires_at,
              v.version, v.environment, v.enabled, v.rollout_percentage,
              v.targeting_rules
       from feature_flags f join lateral (
         select * from feature_flag_versions fv
         where fv.flag_id = f.id and fv.environment = $2
         order by fv.version desc limit 1
       ) v on true where f.key = $1`,
      [key, environment],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      definition: {
        defaultEnabled: row.default_enabled,
        ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
        key: row.key,
        type: row.flag_type,
      },
      version: {
        enabled: row.enabled,
        environment: row.environment,
        ...(row.rollout_percentage === null
          ? {}
          : { rolloutPercentage: Number(row.rollout_percentage) }),
        targetingRules: row.targeting_rules,
        version: row.version,
      },
    };
  }
}

class RedisFlagCache implements FeatureFlagCache {
  constructor(private readonly redis: Redis) {}
  async get(key: string): Promise<FeatureFlagSnapshot | null> {
    const value = await this.redis.get(`atlas:feature-flags:v1:${key}`);
    if (value === null) return null;
    const parsed = JSON.parse(value) as FeatureFlagSnapshot;
    const expiresAt = parsed.definition.expiresAt;
    return {
      ...parsed,
      definition: {
        ...parsed.definition,
        ...(expiresAt === undefined ? {} : { expiresAt: new Date(expiresAt) }),
      },
    };
  }
  async set(
    key: string,
    value: FeatureFlagSnapshot,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.set(
      `atlas:feature-flags:v1:${key}`,
      JSON.stringify(value),
      'EX',
      ttlSeconds,
    );
  }
  async delete(key: string): Promise<void> {
    await this.redis.del(`atlas:feature-flags:v1:${key}`);
  }
}

export class WorkerFeatureFlags {
  private readonly pool: ReturnType<typeof createDatabase>['pool'];
  private readonly redis: Redis;
  private readonly evaluator: FeatureFlagEvaluator;

  constructor(environment: WorkerEnvironment) {
    this.pool = createDatabase(environment.DATABASE_URL).pool;
    this.redis = new Redis(environment.REDIS_URL, { maxRetriesPerRequest: 1 });
    this.evaluator = new FeatureFlagEvaluator(
      new WorkerFlagStore(this.pool),
      new RedisFlagCache(this.redis),
      environment.ATLAS_ENV ?? 'production',
      Object.fromEntries(
        Object.values(WORKER_KILL_SWITCHES).map((key) => [key, 'kill_switch']),
      ),
    );
  }

  async assertAllowed(key: string, resourceId: string): Promise<void> {
    const result = await this.evaluator.evaluate(key, { resourceId });
    if (result.enabled) throw new WorkerKillSwitchError(key, result.version);
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.pool.end(), this.redis.quit()]);
  }
}

export class WorkerKillSwitchError extends Error {
  override readonly name = 'WorkerKillSwitchError';
  constructor(
    readonly flagKey: string,
    readonly flagVersion?: number,
  ) {
    super('WORKER_KILL_SWITCH_ENABLED');
  }
}
