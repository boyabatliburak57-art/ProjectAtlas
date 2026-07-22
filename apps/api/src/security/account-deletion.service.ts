import { createHmac } from 'node:crypto';

import { PostgresRecoveryRepository } from '@atlas/database';
import {
  AccountDeletionService as AccountDeletionApplication,
  RecoveryPolicyError,
} from '@atlas/domain';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ApiDatabase } from '../scanner/scanner-runtime.infrastructure';

@Injectable()
export class AccountDeletionService {
  private readonly application: AccountDeletionApplication;

  constructor(connection: ApiDatabase, config: ConfigService) {
    const environment = config.getOrThrow<string>('ATLAS_ENV');
    const hmacKey = config.getOrThrow<string>('AUTH_SESSION_HMAC_KEY');
    const repository = new PostgresRecoveryRepository(
      connection.pool,
      environment,
    );
    this.application = new AccountDeletionApplication(repository, (value) =>
      createHmac('sha256', hmacKey).update(value, 'utf8').digest('hex'),
    );
  }

  async request(userId: string, body: unknown) {
    const idempotencyKey = deletionInput(body);
    try {
      return await this.application.request(
        { isOperationsAdmin: false, userId },
        userId,
        idempotencyKey,
      );
    } catch (error: unknown) {
      if (
        error instanceof RecoveryPolicyError &&
        error.code === 'ACCOUNT_DELETION_ACCESS_DENIED'
      )
        throw new ForbiddenException({
          code: error.code,
          message: 'Account deletion is not allowed',
        });
      if (
        error instanceof RecoveryPolicyError &&
        error.code === 'ACCOUNT_DELETION_IDEMPOTENCY_CONFLICT'
      )
        throw new ConflictException({
          code: error.code,
          message: 'Idempotency key conflicts with another request',
        });
      throw error;
    }
  }
}

function deletionInput(value: unknown): string {
  if (value === null || typeof value !== 'object')
    throw new ConflictException({
      code: 'ACCOUNT_DELETION_REQUEST_INVALID',
      message: 'A valid deletion request is required',
    });
  const idempotencyKey = (value as Record<string, unknown>)['idempotencyKey'];
  if (
    typeof idempotencyKey !== 'string' ||
    idempotencyKey.length < 8 ||
    idempotencyKey.length > 160
  )
    throw new ConflictException({
      code: 'ACCOUNT_DELETION_REQUEST_INVALID',
      message: 'A valid deletion request is required',
    });
  return idempotencyKey;
}
