import type {
  AccountDeletionRepository,
  AccountDeletionRequest,
  RetentionCandidate,
  RetentionCategory,
  RetentionRepository,
  RetentionRunResult,
} from '@atlas/domain';
import type { Pool, PoolClient } from 'pg';

interface RetentionRunRow {
  deleted_count: string;
  execution_key: string;
  policy_code: RetentionCategory;
  scanned_count: string;
  skipped_count: string;
  status: string;
}

interface DeletionRow {
  grace_until: Date;
  id: string;
  idempotency_key: string;
  status: AccountDeletionRequest['status'];
  subject_hash: string;
  user_id: string | null;
}

export interface ArtifactDeletionPort {
  deleteByOwner(userId: string): Promise<void>;
}

export class PostgresRecoveryRepository
  implements RetentionRepository, AccountDeletionRepository
{
  constructor(
    private readonly pool: Pool,
    private readonly environment: string,
    private readonly artifactDeletion: ArtifactDeletionPort = {
      deleteByOwner: () => Promise.resolve(),
    },
  ) {}

  async begin(input: {
    readonly executionKey: string;
    readonly policyCode: RetentionCategory;
    readonly policyVersion: string;
    readonly startedAt: Date;
  }): Promise<{ readonly replay?: RetentionRunResult }> {
    const inserted = await this.pool.query(
      `insert into retention_job_runs
        (execution_key, policy_code, policy_version, status, started_at)
       values ($1, $2, $3, 'running', $4)
       on conflict (execution_key) do nothing
       returning id`,
      [
        input.executionKey,
        input.policyCode,
        input.policyVersion,
        input.startedAt,
      ],
    );
    if (inserted.rowCount === 1) return {};
    const existing = await this.pool.query<RetentionRunRow>(
      `select execution_key, policy_code, status, scanned_count,
              deleted_count, skipped_count
       from retention_job_runs where execution_key = $1`,
      [input.executionKey],
    );
    const row = existing.rows[0];
    if (row?.status !== 'completed')
      throw new Error('RETENTION_RUN_ALREADY_ACTIVE');
    return {
      replay: {
        deletedCount: Number(row.deleted_count),
        executionKey: row.execution_key,
        policyCode: row.policy_code,
        scannedCount: Number(row.scanned_count),
        skippedCount: Number(row.skipped_count),
        status: 'completed',
      },
    };
  }

  async candidates(input: {
    readonly category: RetentionCategory;
    readonly cutoff: Date;
    readonly limit: number;
  }): Promise<readonly RetentionCandidate[]> {
    const statement = candidateStatement(input.category);
    if (statement === null) return [];
    const result = await this.pool.query<{
      id: string;
      owner_user_id: string | null;
    }>(statement, [input.cutoff, input.limit]);
    return result.rows.map((row) => ({
      category: input.category,
      id: String(row.id),
      ...(row.owner_user_id === null ? {} : { ownerUserId: row.owner_user_id }),
    }));
  }

  async isHeld(candidate: RetentionCandidate, now: Date): Promise<boolean> {
    const result = await this.pool.query(
      `select 1 from legal_holds
       where status = 'active'
         and starts_at <= $1
         and (expires_at is null or expires_at > $1)
         and ((scope_type = $2 and scope_id = $3)
           or (scope_type = 'user' and scope_id = $4))
       limit 1`,
      [now, candidate.category, candidate.id, candidate.ownerUserId ?? ''],
    );
    return result.rowCount === 1;
  }

  async deleteCandidate(
    candidate: RetentionCandidate,
    now: Date,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const deleted = await deleteRetentionCandidate(client, candidate, now);
      await client.query('commit');
      return deleted;
    } catch (error: unknown) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(result: RetentionRunResult, completedAt: Date): Promise<void> {
    await this.pool.query(
      `update retention_job_runs
       set status = 'completed', scanned_count = $2, deleted_count = $3,
           skipped_count = $4, completed_at = $5
       where execution_key = $1 and status = 'running'`,
      [
        result.executionKey,
        result.scannedCount,
        result.deletedCount,
        result.skippedCount,
        completedAt,
      ],
    );
  }

  async fail(
    executionKey: string,
    errorCode: string,
    failedAt: Date,
  ): Promise<void> {
    await this.pool.query(
      `update retention_job_runs
       set status = 'failed', error_summary = jsonb_build_object('code', $2::text),
           completed_at = $3
       where execution_key = $1 and status = 'running'`,
      [executionKey, errorCode, failedAt],
    );
  }

  async audit(input: {
    readonly action: string;
    readonly actorUserId?: string;
    readonly resourceId: string;
    readonly result?: Readonly<Record<string, unknown>>;
    readonly occurredAt: Date;
  }): Promise<void> {
    await this.pool.query(
      `insert into operational_audit_events
        (actor_user_id, actor_type, action, resource_type, resource_id,
         environment, after_state, created_at)
       values ($1, $2, $3, 'data_lifecycle', $4, $5, $6, $7)`,
      [
        input.actorUserId ?? null,
        input.actorUserId === undefined ? 'system' : 'user',
        input.action,
        input.resourceId,
        this.environment,
        JSON.stringify(input.result ?? {}),
        input.occurredAt,
      ],
    );
  }

  async findByIdempotencyKey(
    key: string,
  ): Promise<AccountDeletionRequest | null> {
    const result = await this.pool.query<DeletionRow>(
      `select id, user_id, subject_hash, idempotency_key, status, grace_until
       from account_deletion_requests where idempotency_key = $1`,
      [key],
    );
    return result.rows[0] === undefined ? null : deletionDto(result.rows[0]);
  }

  async disableAndSchedule(input: {
    readonly graceUntil: Date;
    readonly idempotencyKey: string;
    readonly requestedAt: Date;
    readonly subjectHash: string;
    readonly userId: string;
  }): Promise<AccountDeletionRequest> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const disabled = await client.query(
        `update security_users set account_status = 'disabled', updated_at = $2
         where id = $1 and account_status in ('active', 'locked')`,
        [input.userId, input.requestedAt],
      );
      if (disabled.rowCount !== 1) throw new Error('ACCOUNT_NOT_DELETABLE');
      const result = await client.query<DeletionRow>(
        `insert into account_deletion_requests
          (user_id, subject_hash, idempotency_key, status, requested_at,
           grace_until)
         values ($1, $2, $3, 'disabled', $4, $5)
         returning id, user_id, subject_hash, idempotency_key, status,
                   grace_until`,
        [
          input.userId,
          input.subjectHash,
          input.idempotencyKey,
          input.requestedAt,
          input.graceUntil,
        ],
      );
      await client.query('commit');
      return deletionDto(result.rows[0]!);
    } catch (error: unknown) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeSessions(userId: string, now: Date): Promise<void> {
    await this.pool.query(
      `update auth_sessions set revoked_at = $2, revoke_reason = 'account_deletion'
       where user_id = $1 and revoked_at is null`,
      [userId, now],
    );
  }

  async due(
    now: Date,
    limit: number,
  ): Promise<readonly AccountDeletionRequest[]> {
    const result = await this.pool.query<DeletionRow>(
      `select id, user_id, subject_hash, idempotency_key, status, grace_until
       from account_deletion_requests
       where status in ('disabled', 'failed') and grace_until <= $1
       order by grace_until, id limit $2`,
      [now, limit],
    );
    return result.rows.map(deletionDto);
  }

  async isUserHeld(userId: string, now: Date): Promise<boolean> {
    const result = await this.pool.query(
      `select 1 from legal_holds
       where scope_type = 'user' and scope_id = $1 and status = 'active'
         and starts_at <= $2 and (expires_at is null or expires_at > $2)
       limit 1`,
      [userId, now],
    );
    return result.rowCount === 1;
  }

  async claim(requestId: string, now: Date): Promise<boolean> {
    const result = await this.pool.query(
      `update account_deletion_requests
       set status = 'purging', purge_started_at = $2,
           attempt_count = attempt_count + 1, last_error_code = null
       where id = $1 and status in ('disabled', 'failed')`,
      [requestId, now],
    );
    return result.rowCount === 1;
  }

  async deleteArtifacts(userId: string, now: Date): Promise<void> {
    await this.artifactDeletion.deleteByOwner(userId);
    await this.pool.query(
      `update stored_artifacts
       set status = 'deleted', deleted_at = $2
       where owner_user_id = $1 and status <> 'deleted'`,
      [userId, now],
    );
  }

  async purgePrivateResources(userId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      for (const statement of ACCOUNT_PURGE_STATEMENTS)
        await client.query(statement, [userId]);
      await client.query('commit');
    } catch (error: unknown) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteIdentityAndTombstone(
    requestId: string,
    userId: string,
    now: Date,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        'update account_deletion_requests set user_id = null where id = $1 and user_id = $2',
        [requestId, userId],
      );
      await client.query('delete from security_users where id = $1', [userId]);
      const completed = await client.query(
        `update account_deletion_requests
         set status = 'completed', completed_at = $2
         where id = $1 and user_id is null and status = 'purging'`,
        [requestId, now],
      );
      if (completed.rowCount !== 1) throw new Error('TOMBSTONE_FAILED');
      await client.query('commit');
    } catch (error: unknown) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async markFailed(requestId: string, errorCode: string): Promise<void> {
    await this.pool.query(
      `update account_deletion_requests
       set status = 'failed', last_error_code = $2
       where id = $1 and status = 'purging'`,
      [requestId, errorCode],
    );
  }
}

function candidateStatement(category: RetentionCategory): string | null {
  switch (category) {
    case 'notifications':
      return `select id::text, user_id::text as owner_user_id
              from notifications where created_at < $1
              order by created_at, id limit $2`;
    case 'scan_details':
      return `select r.id::text, s.requested_by::text as owner_user_id
              from scan_results r join scan_runs s on s.id = r.scan_run_id
              where r.created_at < $1 order by r.created_at, r.id limit $2`;
    case 'backtest_details':
      return `select id::text, requested_by::text as owner_user_id
              from backtest_runs where completed_at < $1
                and status in ('completed', 'failed', 'cancelled', 'expired')
              order by completed_at, id limit $2`;
    case 'exports':
      return `select id::text, owner_user_id::text
              from stored_artifacts
              where artifact_type = 'export' and status = 'active'
                and coalesce(retention_until, created_at) < $1
              order by coalesce(retention_until, created_at), id limit $2`;
    case 'import_files':
      return `select id::text, owner_user_id::text
              from stored_artifacts
              where artifact_type = 'import' and status = 'active'
                and coalesce(retention_until, created_at) < $1
              order by coalesce(retention_until, created_at), id limit $2`;
    case 'audit_records':
      return `select id::text, actor_user_id::text as owner_user_id
              from operational_audit_events where created_at < $1
              order by created_at, id limit $2`;
    case 'incidents':
      return `select id::text, commander_user_id::text as owner_user_id
              from incidents where status = 'resolved' and resolved_at < $1
              order by resolved_at, id limit $2`;
    case 'deleted_accounts':
      return `select id::text, null::text as owner_user_id
              from account_deletion_requests
              where status = 'completed' and completed_at < $1
              order by completed_at, id limit $2`;
    case 'operational_logs':
      return null;
  }
}

async function deleteRetentionCandidate(
  client: PoolClient,
  candidate: RetentionCandidate,
  now: Date,
): Promise<boolean> {
  switch (candidate.category) {
    case 'notifications':
      return (
        (
          await client.query('delete from notifications where id = $1', [
            candidate.id,
          ])
        ).rowCount === 1
      );
    case 'scan_details':
      return (
        (
          await client.query('delete from scan_results where id = $1', [
            candidate.id,
          ])
        ).rowCount === 1
      );
    case 'backtest_details': {
      await client.query('delete from backtest_trades where run_id = $1', [
        candidate.id,
      ]);
      await client.query('delete from backtest_fills where run_id = $1', [
        candidate.id,
      ]);
      await client.query('delete from backtest_orders where run_id = $1', [
        candidate.id,
      ]);
      const chunks = await client.query(
        'delete from backtest_series_chunks where run_id = $1',
        [candidate.id],
      );
      return (chunks.rowCount ?? 0) > 0;
    }
    case 'exports':
    case 'import_files':
      return (
        (
          await client.query(
            `update stored_artifacts set status = 'deleted', deleted_at = $2
           where id = $1 and status <> 'deleted'`,
            [candidate.id, now],
          )
        ).rowCount === 1
      );
    case 'audit_records':
      return (
        (
          await client.query(
            'delete from operational_audit_events where id = $1',
            [candidate.id],
          )
        ).rowCount === 1
      );
    case 'deleted_accounts':
      return (
        (
          await client.query(
            `delete from account_deletion_requests
             where id = $1 and status = 'completed'`,
            [candidate.id],
          )
        ).rowCount === 1
      );
    case 'incidents':
      await client.query(
        `select set_config('atlas.retention_purge', 'on', true)`,
      );
      await client.query(
        'delete from incident_timeline_events where incident_id = $1',
        [candidate.id],
      );
      return (
        (
          await client.query(
            `delete from incidents where id = $1 and status = 'resolved'`,
            [candidate.id],
          )
        ).rowCount === 1
      );
    case 'operational_logs':
      return false;
  }
}

function deletionDto(row: DeletionRow): AccountDeletionRequest {
  return {
    graceUntil: row.grace_until,
    id: row.id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    subjectHash: row.subject_hash,
    ...(row.user_id === null ? {} : { userId: row.user_id }),
  };
}

const ACCOUNT_PURGE_STATEMENTS = [
  `delete from notification_outbox where delivery_id in
     (select id from notification_deliveries where user_id = $1)`,
  `delete from notification_deliveries where user_id = $1`,
  `delete from notifications where user_id = $1`,
  `delete from notification_preferences where user_id = $1`,
  `delete from alert_triggers where alert_id in
     (select id from alerts where owner_user_id = $1)`,
  `delete from alert_evaluations where alert_id in
     (select id from alerts where owner_user_id = $1)`,
  `delete from alert_states where alert_id in
     (select id from alerts where owner_user_id = $1)`,
  `delete from alert_revisions where alert_id in
     (select id from alerts where owner_user_id = $1)`,
  `delete from alerts where owner_user_id = $1`,
  `delete from watchlists where owner_user_id = $1`,
  `delete from scan_runs where requested_by = $1`,
  `delete from saved_scan_revisions where saved_scan_id in
     (select id from saved_scans where owner_user_id = $1)`,
  `delete from saved_scans where owner_user_id = $1`,
  `delete from portfolio_import_jobs where user_id = $1`,
  `delete from portfolio_risk_snapshots where portfolio_id in
     (select id from portfolios where user_id = $1)`,
  `delete from portfolio_valuation_snapshots where portfolio_id in
     (select id from portfolios where user_id = $1)`,
  `delete from portfolio_performance_snapshots where portfolio_id in
     (select id from portfolios where user_id = $1)`,
  `delete from portfolio_positions where portfolio_id in
     (select id from portfolios where user_id = $1)`,
  `delete from portfolio_cash_balances where portfolio_id in
     (select id from portfolios where user_id = $1)`,
  `delete from portfolio_transactions where portfolio_id in
     (select id from portfolios where user_id = $1)`,
  `delete from portfolios where user_id = $1`,
  `delete from research_experiments where owner_user_id = $1`,
  `delete from backtest_trades where owner_user_id = $1`,
  `delete from backtest_fills where owner_user_id = $1`,
  `delete from backtest_orders where owner_user_id = $1`,
  `delete from backtest_series_chunks where owner_user_id = $1`,
  `delete from backtest_summaries where owner_user_id = $1`,
  `delete from backtest_runs where requested_by = $1`,
  `delete from strategy_revisions where created_by = $1`,
  `delete from strategies where owner_user_id = $1`,
] as const;
