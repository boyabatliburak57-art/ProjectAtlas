/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import type { Server } from 'node:http';

import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  PortfolioError,
  type Portfolio,
  type PortfolioPerformanceSnapshot,
  type PortfolioProjection,
  type PortfolioRiskSnapshot,
  type PortfolioTransaction,
  type PortfolioValuationSnapshot,
} from '@atlas/domain';
import type { Request } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';

import {
  AUTHENTICATED_USER_RESOLVER,
  type AuthenticatedUserResolver,
} from '../common/auth/authenticated-user';
import { GlobalExceptionFilter } from '../common/http/global-exception.filter';
import { PortfoliosController } from './portfolios.controller';
import {
  PORTFOLIO_APPLICATION,
  PORTFOLIO_COMMAND_GUARD,
  PORTFOLIO_READ_MODEL,
  type PortfolioCommandGuard,
  type PortfolioCommands,
  type PortfolioReadModel,
  type PositionPageQuery,
} from './portfolios.ports';
import { PortfoliosService } from './portfolios.service';

const owner = '00000000-0000-4000-8000-000000004701';
const other = '00000000-0000-4000-8000-000000004702';
const portfolioId = '00000000-0000-4000-8000-000000004711';
const otherPortfolioId = '00000000-0000-4000-8000-000000004712';
const instrumentId = '00000000-0000-4000-8000-000000004721';
const at = new Date('2026-07-15T18:00:00.000Z');

class FixtureCommands implements PortfolioCommands {
  readonly portfolios = new Map<string, Portfolio>([
    [portfolioId, makePortfolio(portfolioId, owner)],
    [otherPortfolioId, makePortfolio(otherPortfolioId, other)],
  ]);
  readonly transactions = new Map<string, PortfolioTransaction>();
  private readonly idempotency = new Map<
    string,
    { hash: string; transaction: PortfolioTransaction }
  >();
  private sequence = 0;

  list(userId: string, includeDeleted = false) {
    return Promise.resolve(
      [...this.portfolios.values()].filter(
        (item) =>
          item.userId === userId &&
          (includeDeleted || item.status !== 'deleted'),
      ),
    );
  }
  get(userId: string, id: string) {
    return Promise.resolve(this.owned(userId, id, true));
  }
  create(input: {
    userId: string;
    name: string;
    description?: string | null;
    defaultBenchmarkCode?: string | null;
  }) {
    const id = `00000000-0000-4000-8000-${String(4_800 + this.portfolios.size).padStart(12, '0')}`;
    const value = {
      ...makePortfolio(id, input.userId),
      name: input.name,
      description: input.description ?? null,
      defaultBenchmarkCode: input.defaultBenchmarkCode ?? null,
    };
    this.portfolios.set(id, value);
    return Promise.resolve(value);
  }
  update(input: {
    userId: string;
    portfolioId: string;
    name: string;
    description?: string | null;
    defaultBenchmarkCode?: string | null;
  }) {
    const current = this.owned(input.userId, input.portfolioId, false);
    const value = {
      ...current,
      name: input.name,
      description: input.description ?? null,
      defaultBenchmarkCode: input.defaultBenchmarkCode ?? null,
      updatedAt: new Date(at.getTime() + 1),
    };
    this.portfolios.set(value.id, value);
    return Promise.resolve(value);
  }
  delete(userId: string, id: string) {
    const current = this.owned(userId, id, false);
    const value: Portfolio = { ...current, status: 'deleted', deletedAt: at };
    this.portfolios.set(id, value);
    return Promise.resolve(value);
  }
  restore(userId: string, id: string) {
    const current = this.owned(userId, id, true);
    const value: Portfolio = { ...current, status: 'active', deletedAt: null };
    this.portfolios.set(id, value);
    return Promise.resolve(value);
  }
  listTransactions(userId: string, id: string) {
    this.owned(userId, id, true);
    return Promise.resolve(
      [...this.transactions.values()].filter((item) => item.portfolioId === id),
    );
  }
  getTransaction(userId: string, id: string, transactionId: string) {
    this.owned(userId, id, true);
    const value = this.transactions.get(transactionId);
    if (!value) throw new PortfolioError('PORTFOLIO_TRANSACTION_NOT_FOUND');
    if (value.portfolioId !== id)
      throw new PortfolioError('PORTFOLIO_TRANSACTION_ACCESS_DENIED');
    return Promise.resolve(value);
  }
  createDraft(input: Parameters<PortfolioCommands['createDraft']>[0]) {
    this.owned(input.userId, input.portfolioId, false);
    const identity = `${input.portfolioId}:${input.idempotencyKey}`;
    const hash = JSON.stringify({ ...input, idempotencyKey: undefined });
    const existing = this.idempotency.get(identity);
    if (existing) {
      if (existing.hash !== hash)
        throw new PortfolioError('PORTFOLIO_IDEMPOTENCY_CONFLICT');
      return Promise.resolve({
        transaction: existing.transaction,
        replayed: true,
      });
    }
    this.sequence += 1;
    const transaction = makeTransaction(
      input.portfolioId,
      this.sequence,
      input,
    );
    this.transactions.set(transaction.id, transaction);
    this.idempotency.set(identity, { hash, transaction });
    return Promise.resolve({ transaction, replayed: false });
  }
  async post(userId: string, id: string, transactionId: string) {
    const portfolio = this.owned(userId, id, false);
    const transaction = await this.getTransaction(userId, id, transactionId);
    if (transaction.status !== 'draft')
      throw new PortfolioError('PORTFOLIO_TRANSACTION_INVALID_STATE');
    if (transaction.type === 'sell' && Number(transaction.quantity) > 10)
      throw new PortfolioError('PORTFOLIO_INSUFFICIENT_POSITION');
    const posted = { ...transaction, status: 'posted' as const, postedAt: at };
    this.transactions.set(transactionId, posted);
    const updated = {
      ...portfolio,
      ledgerVersion: portfolio.ledgerVersion + 1,
    };
    this.portfolios.set(id, updated);
    return {
      outcome: 'committed' as const,
      portfolio: updated,
      transaction: posted,
      projection: fixtureProjection(updated.ledgerVersion),
    };
  }
  async reverse(userId: string, id: string, transactionId: string) {
    const portfolio = this.owned(userId, id, false);
    const original = await this.getTransaction(userId, id, transactionId);
    if (original.status !== 'posted')
      throw new PortfolioError('PORTFOLIO_TRANSACTION_INVALID_STATE');
    this.transactions.set(transactionId, {
      ...original,
      status: 'reversed',
      reversedAt: at,
    });
    this.sequence += 1;
    const reversal = {
      ...original,
      id: transactionId.replace(/.$/, '9'),
      sequence: this.sequence,
      reversalOfTransactionId: transactionId,
      status: 'posted' as const,
    };
    this.transactions.set(reversal.id, reversal);
    const updated = {
      ...portfolio,
      ledgerVersion: portfolio.ledgerVersion + 1,
    };
    this.portfolios.set(id, updated);
    return {
      outcome: 'committed' as const,
      portfolio: updated,
      transaction: reversal,
      projection: fixtureProjection(updated.ledgerVersion),
    };
  }
  rebuildProjection(userId: string, id: string) {
    const portfolio = this.owned(userId, id, false);
    return Promise.resolve(fixtureProjection(portfolio.ledgerVersion));
  }
  private owned(userId: string, id: string, allowDeleted: boolean) {
    const value = this.portfolios.get(id);
    if (!value) throw new PortfolioError('PORTFOLIO_NOT_FOUND');
    if (value.userId !== userId)
      throw new PortfolioError('PORTFOLIO_ACCESS_DENIED');
    if (!allowDeleted && value.status === 'deleted')
      throw new PortfolioError('PORTFOLIO_DELETED');
    return value;
  }
}

class FixtureReadModel implements PortfolioReadModel {
  valuationStatus: PortfolioValuationSnapshot['status'] = 'partial';
  projection() {
    return Promise.resolve(fixtureProjection(1));
  }
  positionsPage(input: PositionPageQuery) {
    const values = Array.from({ length: 7 }, (_, index) => ({
      portfolioId: input.portfolioId,
      instrumentId: `00000000-0000-4000-8000-${String(4_721 + index).padStart(12, '0')}`,
      symbol: `P${String(index + 1).padStart(2, '0')}`,
      company: `Position ${index + 1}`,
      quantity: index === 0 ? '2.500000000000' : `${index + 1}.000000000000`,
      averageCost: index === 0 ? '10.2500000000' : '10.0000000000',
      costBasis:
        index === 0 ? '25.6250000000' : `${(index + 1) * 10}.0000000000`,
      realizedPnl: '0.0000000000',
      dividendIncome: '0.0000000000',
      marketValue: '100.0000000000',
      weight: '0.142857142857',
      unrealizedPnl: `${index}.0000000000`,
      dailyChange: null,
      sectorId: null,
      dataTime: at,
      ledgerVersion: input.projectionLedgerVersion,
      calculatedAt: at,
    }));
    const filtered = input.symbol
      ? values.filter(({ symbol }) => symbol.startsWith(input.symbol ?? ''))
      : values;
    const valueFor = (item: (typeof values)[number]) =>
      input.sortField === 'symbol'
        ? item.symbol
        : input.sortField === 'marketValue'
          ? (item.marketValue ?? '')
          : input.sortField === 'weight'
            ? (item.weight ?? '')
            : input.sortField === 'unrealizedPnl'
              ? (item.unrealizedPnl ?? '')
              : '0';
    const ordered = [...filtered].sort((left, right) => {
      const primary = valueFor(left).localeCompare(valueFor(right), 'en', {
        numeric: input.sortField !== 'symbol',
      });
      const tie = left.instrumentId.localeCompare(right.instrumentId);
      return input.sortDirection === 'asc' ? primary || tie : -(primary || tie);
    });
    const remaining = input.cursor
      ? ordered.filter((item) => {
          const primary = valueFor(item).localeCompare(
            input.cursor?.sortValue ?? '',
            'en',
            { numeric: input.sortField !== 'symbol' },
          );
          const tie = item.instrumentId.localeCompare(
            input.cursor?.instrumentId ?? '',
          );
          return input.sortDirection === 'asc'
            ? primary > 0 || (primary === 0 && tie > 0)
            : primary < 0 || (primary === 0 && tie < 0);
        })
      : ordered;
    const selected = remaining.slice(0, input.limit + 1);
    const hasNext = selected.length > input.limit;
    const items = hasNext ? selected.slice(0, input.limit) : selected;
    const last = items.at(-1);
    return Promise.resolve({
      items,
      nextCursor:
        hasNext && last
          ? { sortValue: valueFor(last), instrumentId: last.instrumentId }
          : null,
      projectionLedgerVersion: input.projectionLedgerVersion,
      dataCutoffAt: at,
    });
  }
  latestValuation() {
    return Promise.resolve(fixtureValuation(this.valuationStatus));
  }
  valuationHistory() {
    return Promise.resolve({
      items: [fixtureValuation(this.valuationStatus)],
      nextCursor: null,
    });
  }
  latestPerformance() {
    return Promise.resolve(fixturePerformance());
  }
  latestRisk() {
    return Promise.resolve(fixtureRisk());
  }
  invalidate() {
    return Promise.resolve();
  }
}

class FixtureCommandGuard implements PortfolioCommandGuard {
  readonly values = new Map<string, { requestHash: string; value: unknown }>();
  calls = 0;
  async execute<T>(input: {
    readonly userId: string;
    readonly operation: string;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly operationFactory: () => Promise<T>;
  }): Promise<{ readonly value: T; readonly replayed: boolean }> {
    const key = `${input.userId}:${input.operation}:${input.idempotencyKey}`;
    const existing = this.values.get(key);
    if (existing) {
      if (existing.requestHash !== input.requestHash)
        throw new PortfolioError('PORTFOLIO_IDEMPOTENCY_CONFLICT');
      return { value: existing.value as T, replayed: true };
    }
    const value = await input.operationFactory();
    this.values.set(key, { requestHash: input.requestHash, value });
    return { value, replayed: false };
  }
  consumeRateLimit() {
    this.calls += 1;
    if (this.calls > 1)
      throw new PortfolioError('PORTFOLIO_RECALCULATE_RATE_LIMITED');
  }
}

describe('Portfolio API', () => {
  let app: INestApplication;
  let server: Server;
  let commands: FixtureCommands;
  let guard: FixtureCommandGuard;

  beforeAll(async () => {
    commands = new FixtureCommands();
    guard = new FixtureCommandGuard();
    const resolver: AuthenticatedUserResolver = (req: Request) =>
      String(req.headers['x-user-id'] ?? owner);
    const module = await Test.createTestingModule({
      controllers: [PortfoliosController],
      providers: [
        PortfoliosService,
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        { provide: AUTHENTICATED_USER_RESOLVER, useValue: resolver },
        { provide: PORTFOLIO_APPLICATION, useValue: commands },
        { provide: PORTFOLIO_READ_MODEL, useClass: FixtureReadModel },
        { provide: PORTFOLIO_COMMAND_GUARD, useValue: guard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(() => app.close());

  it('supports portfolio CRUD, soft delete and restore', async () => {
    const created = await api()
      .post('/api/v1/portfolios')
      .send({ name: 'Long term' })
      .expect(201);
    const id = String(created.body.data.id);
    await api().get('/api/v1/portfolios').expect(200);
    await api().get(`/api/v1/portfolios/${id}`).expect(200);
    await api()
      .patch(`/api/v1/portfolios/${id}`)
      .send({ name: 'Updated' })
      .expect(200);
    await api().delete(`/api/v1/portfolios/${id}`).expect(200);
    await api().post(`/api/v1/portfolios/${id}/restore`).expect(200);
  });

  it('denies portfolio ownership IDOR', async () => {
    const response = await api()
      .get(`/api/v1/portfolios/${otherPortfolioId}`)
      .expect(403);
    expect(response.body.error.code).toBe('PORTFOLIO_ACCESS_DENIED');
  });

  it('creates, gets, posts and reverses transactions', async () => {
    const created = await createTransaction('transaction-flow', {
      type: 'buy',
      instrumentId,
      tradeAt: at.toISOString(),
      quantity: '2.000000000000',
      unitPrice: '10.2500000000',
    });
    const id = String(created.body.data.id);
    await api()
      .get(`/api/v1/portfolios/${portfolioId}/transactions/${id}`)
      .expect(200);
    const posted = await api()
      .post(`/api/v1/portfolios/${portfolioId}/transactions/${id}/post`)
      .set('Idempotency-Key', 'post-flow')
      .expect(200);
    expect(posted.body.data.status).toBe('posted');
    const reversed = await api()
      .post(`/api/v1/portfolios/${portfolioId}/transactions/${id}/reverse`)
      .set('Idempotency-Key', 'reverse-flow')
      .expect(200);
    expect(reversed.body.data.reversalOfTransactionId).toBe(id);
  });

  it('denies transaction IDOR independently from portfolio IDOR', async () => {
    const created = await createTransaction('transaction-idor', {
      type: 'cashDeposit',
      tradeAt: at.toISOString(),
      cashAmount: '100',
    });
    const id = String(created.body.data.id);
    const response = await api()
      .get(`/api/v1/portfolios/${otherPortfolioId}/transactions/${id}`)
      .set('x-user-id', other)
      .expect(403);
    expect(response.body.error.code).toBe(
      'PORTFOLIO_TRANSACTION_ACCESS_DENIED',
    );
  });

  it('replays an identical transaction request and conflicts on changed payload', async () => {
    const idempotencyKey = `portfolio-transaction-${portfolioId}`;
    const body = {
      type: 'cashDeposit',
      tradeAt: at.toISOString(),
      cashAmount: '100.00',
    };
    await createTransaction(idempotencyKey, body).then((value) =>
      expect(value.status).toBe(201),
    );
    const replay = await createTransaction(idempotencyKey, body);
    expect(replay.status).toBe(200);
    expect(replay.body.meta.replayed).toBe(true);
    const conflict = await createTransaction(idempotencyKey, {
      ...body,
      cashAmount: '101.00',
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('PORTFOLIO_IDEMPOTENCY_CONFLICT');
  });

  it('does not expose a PATCH endpoint for posted transactions', async () => {
    await api()
      .patch(
        `/api/v1/portfolios/${portfolioId}/transactions/00000000-0000-4000-8000-000000004799`,
      )
      .send({ note: 'mutate' })
      .expect(404);
  });

  it('returns stable insufficient quantity error', async () => {
    const created = await createTransaction('too-much', {
      type: 'sell',
      instrumentId,
      tradeAt: at.toISOString(),
      quantity: '99',
      unitPrice: '10',
    });
    const response = await api()
      .post(
        `/api/v1/portfolios/${portfolioId}/transactions/${String(created.body.data.id)}/post`,
      )
      .set('Idempotency-Key', 'post-too-much')
      .expect(422);
    expect(response.body.error.code).toBe('PORTFOLIO_INSUFFICIENT_POSITION');
  });

  it('returns positions as decimal strings', async () => {
    const response = await api()
      .get(`/api/v1/portfolios/${portfolioId}/positions`)
      .expect(200);
    expect(response.body.data.items[0]).toMatchObject({
      quantity: '2.500000000000',
      averageCost: '10.2500000000',
      costBasis: '25.6250000000',
    });
    expect(response.body.meta).toMatchObject({
      limit: 50,
      dataCutoffAt: at.toISOString(),
    });
    expect(response.body.meta.projectionLedgerVersion).toEqual(
      expect.any(Number),
    );
  });

  it('paginates the first, middle and last position pages without duplicates or missing rows', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    const pageSizes: number[] = [];
    do {
      const response = await api()
        .get(`/api/v1/portfolios/${portfolioId}/positions`)
        .query({ limit: 3, ...(cursor ? { cursor } : {}) })
        .expect(200);
      const items = response.body.data.items as { instrumentId: string }[];
      pageSizes.push(items.length);
      seen.push(...items.map(({ instrumentId: id }) => id));
      cursor = response.body.meta.nextCursor as string | null;
    } while (cursor);
    expect(pageSizes).toEqual([3, 3, 1]);
    expect(new Set(seen).size).toBe(7);
    expect(seen).toHaveLength(7);
  });

  it('uses a stable unique tie-breaker for equal sort values in ASC and DESC order', async () => {
    for (const sortDirection of ['asc', 'desc']) {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const response = await api()
          .get(`/api/v1/portfolios/${portfolioId}/positions`)
          .query({
            limit: 2,
            sortField: 'marketValue',
            sortDirection,
            ...(cursor ? { cursor } : {}),
          })
          .expect(200);
        const items = response.body.data.items as { instrumentId: string }[];
        seen.push(...items.map(({ instrumentId: id }) => id));
        cursor = response.body.meta.nextCursor as string | null;
      } while (cursor);
      expect(new Set(seen).size).toBe(7);
      expect(seen).toHaveLength(7);
    }
  });

  it('rejects invalid, cross-context, sort and filter mismatched cursors', async () => {
    const invalid = await api()
      .get(`/api/v1/portfolios/${portfolioId}/positions?cursor=not-a-cursor`)
      .expect(400);
    expect(invalid.body.error.code).toBe('PORTFOLIO_CURSOR_INVALID');

    const first = await api()
      .get(`/api/v1/portfolios/${portfolioId}/positions?limit=2`)
      .expect(200);
    const cursor = String(first.body.meta.nextCursor);
    const versionPayload = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    const versionMismatch = await api()
      .get(`/api/v1/portfolios/${portfolioId}/positions`)
      .query({
        cursor: Buffer.from(
          JSON.stringify({ ...versionPayload, version: 999 }),
          'utf8',
        ).toString('base64url'),
      })
      .expect(400);
    expect(versionMismatch.body.error.code).toBe(
      'PORTFOLIO_CURSOR_VERSION_MISMATCH',
    );
    for (const query of [
      { cursor, sortDirection: 'desc' },
      { cursor, symbol: 'P0' },
    ]) {
      const mismatch = await api()
        .get(`/api/v1/portfolios/${portfolioId}/positions`)
        .query(query)
        .expect(400);
      expect(mismatch.body.error.code).toBe(
        'PORTFOLIO_CURSOR_CONTEXT_MISMATCH',
      );
    }
    const portfolioMismatch = await api()
      .get(`/api/v1/portfolios/${otherPortfolioId}/positions`)
      .set('x-user-id', other)
      .query({ cursor })
      .expect(400);
    expect(portfolioMismatch.body.error.code).toBe(
      'PORTFOLIO_CURSOR_CONTEXT_MISMATCH',
    );
    const userMismatch = await api()
      .get(`/api/v1/portfolios/${portfolioId}/positions`)
      .set('x-user-id', other)
      .query({ cursor })
      .expect(403);
    expect(userMismatch.body.error.code).toBe('PORTFOLIO_ACCESS_DENIED');
  });

  it('returns correct empty and exact-boundary position pages', async () => {
    const empty = await api()
      .get(`/api/v1/portfolios/${portfolioId}/positions`)
      .query({ symbol: 'ZZZ', limit: 1 })
      .expect(200);
    expect(empty.body.data.items).toEqual([]);
    expect(empty.body.meta.nextCursor).toBeNull();

    const exact = await api()
      .get(`/api/v1/portfolios/${portfolioId}/positions`)
      .query({ symbol: 'P01', limit: 1 })
      .expect(200);
    expect(exact.body.data.items).toHaveLength(1);
    expect(exact.body.meta.nextCursor).toBeNull();
  });

  it('detects projection version changes and enforces query bounds', async () => {
    const first = await api()
      .get(`/api/v1/portfolios/${portfolioId}/positions?limit=2`)
      .expect(200);
    const current = commands.portfolios.get(portfolioId)!;
    commands.portfolios.set(portfolioId, {
      ...current,
      ledgerVersion: current.ledgerVersion + 1,
    });
    const changed = await api()
      .get(`/api/v1/portfolios/${portfolioId}/positions`)
      .query({ cursor: String(first.body.meta.nextCursor) })
      .expect(409);
    expect(changed.body.error.code).toBe('PORTFOLIO_PROJECTION_CHANGED');
    commands.portfolios.set(portfolioId, current);

    await api()
      .get(`/api/v1/portfolios/${portfolioId}/positions?limit=101`)
      .expect(400);
  });

  it('preserves partial valuation and stale/missing warnings', async () => {
    const response = await api()
      .get(`/api/v1/portfolios/${portfolioId}/valuation`)
      .expect(200);
    expect(response.body.data.status).toBe('partial');
    expect(response.body.data.warnings).toEqual([
      { code: 'STALE_PRICE', instrumentId },
    ]);
    expect(response.body.data.unrealizedPnl).toBeNull();
  });

  it('returns cursor-shaped valuation history', async () => {
    const response = await api()
      .get(`/api/v1/portfolios/${portfolioId}/valuation-history?limit=10`)
      .expect(200);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.meta.nextCursor).toBeNull();
  });

  it('preserves TWR/XIRR methodology and XIRR notEvaluable reason', async () => {
    const response = await api()
      .get(`/api/v1/portfolios/${portfolioId}/performance`)
      .expect(200);
    expect(response.body.data.performancePolicyVersion).toBe('twr-xirr-v1');
    expect(response.body.data.twr).toEqual({
      status: 'complete',
      value: '0.125',
    });
    expect(response.body.data.xirr).toEqual({
      status: 'notEvaluable',
      reason: 'NO_SOLUTION',
    });
  });

  it('preserves risk methodology versions and insufficient history reasons', async () => {
    const response = await api()
      .get(`/api/v1/portfolios/${portfolioId}/risk`)
      .expect(200);
    expect(response.body.data.riskPolicyVersion).toBe('historical-risk-v1');
    expect(response.body.data.volatility).toMatchObject({
      status: 'notEvaluable',
      reasonCode: 'INSUFFICIENT_OBSERVATIONS',
      methodologyVersion: 'historical-risk-v1',
    });
  });

  it('makes recalculate idempotent and rate limits distinct commands', async () => {
    const first = await api()
      .post(`/api/v1/portfolios/${portfolioId}/recalculate`)
      .set('Idempotency-Key', 'recalculate-one')
      .expect(200);
    const replay = await api()
      .post(`/api/v1/portfolios/${portfolioId}/recalculate`)
      .set('Idempotency-Key', 'recalculate-one')
      .expect(200);
    expect(first.body.meta.replayed).toBe(false);
    expect(replay.body.meta.replayed).toBe(true);
    const limited = await api()
      .post(`/api/v1/portfolios/${portfolioId}/recalculate`)
      .set('Idempotency-Key', 'recalculate-two')
      .expect(429);
    expect(limited.body.error.code).toBe('PORTFOLIO_RECALCULATE_RATE_LIMITED');
  });

  it('rejects transactions on a deleted portfolio', async () => {
    await api().delete(`/api/v1/portfolios/${portfolioId}`).expect(200);
    const response = await createTransaction('deleted-portfolio', {
      type: 'cashDeposit',
      tradeAt: at.toISOString(),
      cashAmount: '1',
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PORTFOLIO_DELETED');
    await api().post(`/api/v1/portfolios/${portfolioId}/restore`).expect(200);
  });

  it('rejects position pagination on a deleted portfolio', async () => {
    await api().delete(`/api/v1/portfolios/${portfolioId}`).expect(200);
    const response = await api()
      .get(`/api/v1/portfolios/${portfolioId}/positions`)
      .expect(409);
    expect(response.body.error.code).toBe('PORTFOLIO_DELETED');
    await api().post(`/api/v1/portfolios/${portfolioId}/restore`).expect(200);
  });

  it('does not leak stack traces in production-shaped error responses', async () => {
    const response = await api()
      .get('/api/v1/portfolios/not-a-uuid')
      .expect(400);
    expect(JSON.stringify(response.body)).not.toContain('stack');
    expect(response.body.error.code).toBe('PORTFOLIO_INVALID');
  });

  function api() {
    return request(server);
  }

  function createTransaction(key: string, body: Record<string, unknown>) {
    return request(server)
      .post(`/api/v1/portfolios/${portfolioId}/transactions`)
      .set('x-user-id', owner)
      .set('Idempotency-Key', key)
      .send(body);
  }
});

function makePortfolio(id: string, userId: string): Portfolio {
  return {
    id,
    userId,
    name: 'Portfolio',
    description: null,
    reportingCurrency: 'TRY',
    defaultBenchmarkCode: 'XU100',
    status: 'active',
    ledgerVersion: 1,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
}

function makeTransaction(
  portfolio: string,
  sequence: number,
  input: Parameters<PortfolioCommands['createDraft']>[0],
): PortfolioTransaction {
  return {
    id: `00000000-0000-4000-8000-${String(4_730 + sequence).padStart(12, '0')}`,
    portfolioId: portfolio,
    instrumentId: input.instrumentId ?? null,
    reversalOfTransactionId: null,
    sequence,
    type: input.type,
    status: 'draft',
    tradeAt: input.tradeAt,
    settlementAt: input.settlementAt ?? null,
    quantity: input.quantity ?? null,
    unitPrice: input.unitPrice ?? null,
    fee: input.fee ?? '0',
    tax: input.tax ?? '0',
    cashAmount: input.cashAmount ?? null,
    source: input.source,
    externalReference: input.externalReference ?? null,
    idempotencyKeyHash: input.idempotencyKey,
    normalizedTransactionHash: JSON.stringify(input),
    corporateActionIdentityHash: null,
    adjustmentReason: input.adjustmentReason ?? null,
    note: input.note ?? null,
    createdBy: input.userId,
    postedAt: null,
    reversedAt: null,
    deletedAt: null,
    createdAt: at,
    updatedAt: at,
  };
}

function fixtureProjection(ledgerVersion: number): PortfolioProjection {
  return {
    ledgerVersion,
    positions: [
      {
        portfolioId,
        instrumentId,
        quantity: '2.500000000000',
        averageCost: '10.2500000000',
        costBasis: '25.6250000000',
        realizedPnl: '0',
        dividendIncome: '0',
        ledgerVersion,
        calculatedAt: at,
      },
    ],
    cashBalances: [
      {
        portfolioId,
        currencyCode: 'TRY',
        balance: '100.0000000000',
        ledgerVersion,
        calculatedAt: at,
      },
    ],
  };
}

function fixtureValuation(
  status: PortfolioValuationSnapshot['status'],
): PortfolioValuationSnapshot {
  return {
    portfolioId,
    ledgerVersion: 1,
    valuationAt: at,
    dataCutoffAt: at,
    pricePolicyVersion: 'closed-daily-v1',
    mode: 'official',
    persistable: true,
    status,
    cashBalance: '100.0000000000',
    positionsMarketValue: '25.6250000000',
    totalValue: '125.6250000000',
    realizedPnl: '0',
    unrealizedPnl: null,
    netContributions: '100.0000000000',
    missingPriceCount: 0,
    warnings: [{ code: 'STALE_PRICE', instrumentId }],
    positions: [],
    cacheKey: 'valuation-key',
  };
}

function fixturePerformance(): PortfolioPerformanceSnapshot {
  return {
    portfolioId,
    ledgerVersion: 1,
    rangeStartAt: at,
    rangeEndAt: at,
    dataCutoffAt: at,
    performancePolicyVersion: 'twr-xirr-v1',
    benchmarkCode: 'XU100',
    status: 'partial',
    dailyValueSeries: [],
    netContributionSeries: [],
    twr: { status: 'complete', value: '0.125' },
    xirr: { status: 'notEvaluable', reason: 'NO_SOLUTION' },
    benchmark: {
      status: 'notEvaluable',
      priceReturn: null,
      totalReturn: null,
      alignedDates: [],
      warnings: ['MISSING_BENCHMARK_DATA'],
    },
    periodReturns: {},
    cacheKey: 'performance-key',
    warnings: ['XIRR_NO_SOLUTION'],
  };
}

function fixtureRisk(): PortfolioRiskSnapshot {
  const failed = {
    value: null,
    status: 'notEvaluable' as const,
    reasonCode: 'INSUFFICIENT_OBSERVATIONS' as const,
    observationCount: 5,
    methodologyVersion: 'historical-risk-v1',
    warnings: [],
  };
  return {
    portfolioId,
    ledgerVersion: 1,
    valuationSeriesVersion: 1,
    rangeStartAt: at,
    rangeEndAt: at,
    dataCutoffAt: at,
    benchmarkCode: 'XU100',
    riskPolicyVersion: 'historical-risk-v1',
    status: 'partial',
    observationCount: 5,
    volatility: failed,
    beta: failed,
    correlation: failed,
    drawdown: failed,
    historicalVar95: failed,
    historicalVar99: failed,
    expectedShortfall95: failed,
    concentration: failed,
    cacheKey: 'risk-key',
    warnings: [],
  };
}
