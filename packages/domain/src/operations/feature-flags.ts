import { createHash } from 'node:crypto';

export type FeatureFlagType =
  | 'release'
  | 'experiment'
  | 'kill_switch'
  | 'entitlement'
  | 'maintenance';

export interface FeatureFlagContext {
  readonly attributes?: Readonly<Record<string, string>>;
  readonly resourceId?: string;
  readonly userId?: string;
}

export interface FeatureFlagDefinition {
  readonly defaultEnabled: boolean;
  readonly expiresAt?: Date;
  readonly key: string;
  readonly type: FeatureFlagType;
}

export interface FeatureFlagVersion {
  readonly enabled: boolean;
  readonly environment: string;
  readonly rolloutPercentage?: number;
  readonly targetingRules: Readonly<Record<string, readonly string[]>>;
  readonly version: number;
}

export interface FeatureFlagEvaluation {
  readonly enabled: boolean;
  readonly reasonCode:
    | 'CONFIGURED'
    | 'EXPIRED'
    | 'SAFE_DEFAULT'
    | 'TARGET_MISMATCH'
    | 'ROLLOUT_EXCLUDED';
  readonly source: 'cache' | 'postgresql' | 'safe_default';
  readonly version?: number;
}

export interface FeatureFlagSnapshot {
  readonly definition: FeatureFlagDefinition;
  readonly version: FeatureFlagVersion;
}

export interface FeatureFlagStore {
  load(key: string, environment: string): Promise<FeatureFlagSnapshot | null>;
}

export interface FeatureFlagCache {
  get(key: string): Promise<FeatureFlagSnapshot | null>;
  set(
    key: string,
    value: FeatureFlagSnapshot,
    ttlSeconds: number,
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

export function stableRolloutBucket(input: {
  readonly environment: string;
  readonly flagKey: string;
  readonly flagVersion: number;
  readonly subjectKey: string;
}): number {
  const digest = createHash('sha256')
    .update(
      `${input.flagKey}\u0000${String(input.flagVersion)}\u0000${input.environment}\u0000${input.subjectKey}`,
    )
    .digest();
  return (digest.readUInt32BE(0) / 0x1_0000_0000) * 100;
}

export function safeDefault(type: FeatureFlagType): boolean {
  return type === 'kill_switch';
}

export function evaluateFeatureFlag(
  snapshot: FeatureFlagSnapshot,
  context: FeatureFlagContext,
  source: FeatureFlagEvaluation['source'],
  now = new Date(),
): FeatureFlagEvaluation {
  const { definition, version } = snapshot;
  if (definition.expiresAt !== undefined && definition.expiresAt <= now)
    return {
      enabled: safeDefault(definition.type),
      reasonCode: 'EXPIRED',
      source,
      version: version.version,
    };
  if (!matchesTargeting(version.targetingRules, context))
    return {
      enabled: false,
      reasonCode: 'TARGET_MISMATCH',
      source,
      version: version.version,
    };
  if (!version.enabled)
    return {
      enabled: false,
      reasonCode: 'CONFIGURED',
      source,
      version: version.version,
    };
  if (version.rolloutPercentage === undefined)
    return {
      enabled: true,
      reasonCode: 'CONFIGURED',
      source,
      version: version.version,
    };
  const subjectKey = context.userId ?? context.resourceId;
  if (subjectKey === undefined)
    return {
      enabled: false,
      reasonCode: 'TARGET_MISMATCH',
      source,
      version: version.version,
    };
  const included =
    stableRolloutBucket({
      environment: version.environment,
      flagKey: definition.key,
      flagVersion: version.version,
      subjectKey,
    }) < version.rolloutPercentage;
  return {
    enabled: included,
    reasonCode: included ? 'CONFIGURED' : 'ROLLOUT_EXCLUDED',
    source,
    version: version.version,
  };
}

export class FeatureFlagEvaluator {
  constructor(
    private readonly store: FeatureFlagStore,
    private readonly cache: FeatureFlagCache,
    private readonly environment: string,
    private readonly types: Readonly<Record<string, FeatureFlagType>>,
    private readonly cacheTtlSeconds = 30,
    private readonly outageSafeDefaultEnabled = true,
  ) {}

  async evaluate(
    key: string,
    context: FeatureFlagContext,
    now = new Date(),
  ): Promise<FeatureFlagEvaluation> {
    const cacheKey = `${this.environment}:${key}`;
    try {
      const cached = await this.cache.get(cacheKey);
      if (cached !== null)
        return evaluateFeatureFlag(cached, context, 'cache', now);
    } catch {
      // Cache is an optional accelerator.
    }
    try {
      const snapshot = await this.store.load(key, this.environment);
      if (snapshot !== null) {
        await this.cache
          .set(cacheKey, snapshot, this.cacheTtlSeconds)
          .catch(() => undefined);
        return evaluateFeatureFlag(snapshot, context, 'postgresql', now);
      }
      return {
        enabled: false,
        reasonCode: 'SAFE_DEFAULT',
        source: 'postgresql',
      };
    } catch {
      // The type-specific safe default below is authoritative on outage.
    }
    return {
      enabled:
        this.outageSafeDefaultEnabled &&
        safeDefault(this.types[key] ?? 'kill_switch'),
      reasonCode: 'SAFE_DEFAULT',
      source: 'safe_default',
    };
  }

  invalidate(key: string): Promise<void> {
    return this.cache.delete(`${this.environment}:${key}`);
  }
}

function matchesTargeting(
  rules: Readonly<Record<string, readonly string[]>>,
  context: FeatureFlagContext,
): boolean {
  for (const [attribute, allowed] of Object.entries(rules)) {
    if (allowed.length === 0) return false;
    const actual =
      attribute === 'userId'
        ? context.userId
        : attribute === 'resourceId'
          ? context.resourceId
          : context.attributes?.[attribute];
    if (actual === undefined || !allowed.includes(actual)) return false;
  }
  return true;
}
