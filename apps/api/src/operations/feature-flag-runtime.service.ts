import {
  FeatureFlagEvaluator,
  type FeatureFlagCache,
  type FeatureFlagContext,
  type FeatureFlagSnapshot,
  type FeatureFlagStore,
  type FeatureFlagType,
} from '@atlas/domain';
import {
  Injectable,
  type OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { ApiDatabase } from '../scanner/scanner-runtime.infrastructure';

export const KILL_SWITCHES = {
  alertEvaluation: 'alerts.evaluation.disabled',
  backtestCreation: 'backtests.creation.disabled',
  emailDelivery: 'notifications.email-delivery.disabled',
  experimentCreation: 'experiments.creation.disabled',
  exports: 'exports.disabled',
  fundamentalsRefresh: 'fundamentals.refresh.disabled',
  patternRefresh: 'patterns.refresh.disabled',
  portfolioImports: 'portfolios.imports.disabled',
  scannerCreation: 'scanner.new-runs.disabled',
} as const;

class PostgresFeatureFlagStore implements FeatureFlagStore {
  constructor(private readonly connection: ApiDatabase) {}

  async load(
    key: string,
    environment: string,
  ): Promise<FeatureFlagSnapshot | null> {
    const result = await this.connection.pool.query<{
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
       from feature_flags f
       join lateral (
         select * from feature_flag_versions fv
         where fv.flag_id = f.id and fv.environment = $2
         order by fv.version desc limit 1
       ) v on true
       where f.key = $1`,
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

class RedisFeatureFlagCache implements FeatureFlagCache {
  constructor(private readonly redis: Redis) {}

  async delete(key: string): Promise<void> {
    await this.redis.del(`atlas:feature-flags:v1:${key}`);
  }

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
}

@Injectable()
export class FeatureFlagRuntimeService implements OnModuleDestroy {
  private readonly cache: RedisFeatureFlagCache;
  private readonly evaluator: FeatureFlagEvaluator;
  private readonly redis: Redis;

  constructor(connection: ApiDatabase, config: ConfigService) {
    const environment = config.getOrThrow<string>('ATLAS_ENV');
    this.redis = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    this.cache = new RedisFeatureFlagCache(this.redis);
    this.evaluator = new FeatureFlagEvaluator(
      new PostgresFeatureFlagStore(connection),
      this.cache,
      environment,
      Object.fromEntries(
        Object.values(KILL_SWITCHES).map((key) => [key, 'kill_switch']),
      ),
      30,
      // Unit-test composition roots may intentionally omit DB-009. Staging and
      // production remain fail-safe; migrated test databases still honor flags.
      environment !== 'test',
    );
  }

  async assertWriteAllowed(
    key: (typeof KILL_SWITCHES)[keyof typeof KILL_SWITCHES],
    context: FeatureFlagContext,
  ): Promise<void> {
    const evaluation = await this.evaluator.evaluate(key, context);
    if (evaluation.enabled)
      throw new ServiceUnavailableException({
        code: 'OPERATION_KILL_SWITCH_ENABLED',
        details: {
          flagKey: key,
          flagVersion: evaluation.version,
          source: evaluation.source,
        },
        message: 'This operation is temporarily unavailable',
      });
  }

  invalidate(key: string): Promise<void> {
    return this.evaluator.invalidate(key).catch(() => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status === 'wait') return;
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
