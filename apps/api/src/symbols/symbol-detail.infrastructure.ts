import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  alerts,
  alertRevisions,
  alertTriggers,
  instruments,
  patternInstances,
  portfolios,
  portfolioTransactions,
  priceBars,
  sectors,
} from '@atlas/database';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import { ApiDatabase } from '../scanner/scanner-runtime.infrastructure';
import type {
  ChartAdjustmentMode,
  CorporateActionView,
  SymbolDetailReader,
  UserChartMarkerView,
} from './symbol-detail.ports';

@Injectable()
export class PostgresSymbolDetailReader implements SymbolDetailReader {
  constructor(@Inject(ApiDatabase) private readonly connection: ApiDatabase) {}

  async profile(normalizedSymbol: string) {
    const row = (
      await this.connection.database
        .select({
          id: instruments.id,
          symbol: instruments.symbol,
          name: instruments.name,
          isin: instruments.isin,
          marketCode: instruments.marketCode,
          currencyCode: instruments.currencyCode,
          status: instruments.status,
          sectorId: sectors.id,
          sectorCode: sectors.code,
          sectorName: sectors.name,
        })
        .from(instruments)
        .leftJoin(sectors, eq(sectors.id, instruments.sectorId))
        .where(eq(instruments.normalizedSymbol, normalizedSymbol))
        .limit(1)
    )[0];
    if (!row) return null;
    return {
      id: row.id,
      symbol: row.symbol,
      name: row.name,
      isin: row.isin,
      marketCode: row.marketCode,
      currencyCode: row.currencyCode,
      status: row.status,
      sector:
        row.sectorId && row.sectorCode && row.sectorName
          ? { id: row.sectorId, code: row.sectorCode, name: row.sectorName }
          : null,
    };
  }

  async bars(input: {
    readonly instrumentId: string;
    readonly timeframe: string;
    readonly from: Date;
    readonly to: Date;
    readonly limit: number;
  }) {
    const rows = await this.connection.database
      .select({
        openTime: priceBars.openTime,
        closeTime: priceBars.closeTime,
        open: priceBars.open,
        high: priceBars.high,
        low: priceBars.low,
        close: priceBars.close,
        volume: priceBars.volume,
        isClosed: priceBars.isClosed,
        sourceTimestamp: priceBars.sourceTimestamp,
        qualityStatus: priceBars.qualityStatus,
        revision: priceBars.revision,
        providerId: priceBars.providerId,
      })
      .from(priceBars)
      .where(
        and(
          eq(priceBars.instrumentId, input.instrumentId),
          eq(priceBars.timeframe, input.timeframe),
          gte(priceBars.openTime, input.from),
          lte(priceBars.openTime, input.to),
        ),
      )
      .orderBy(
        desc(priceBars.openTime),
        desc(priceBars.revision),
        asc(priceBars.providerId),
      )
      .limit(input.limit * 3);
    const unique = new Map<number, (typeof rows)[number]>();
    for (const row of rows) {
      const time = row.openTime.getTime();
      if (!unique.has(time)) unique.set(time, row);
    }
    return [...unique.values()]
      .slice(0, input.limit)
      .sort((left, right) => left.openTime.getTime() - right.openTime.getTime())
      .map((row) => ({
        openTime: row.openTime,
        closeTime: row.closeTime,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
        isClosed: row.isClosed,
        sourceTimestamp: row.sourceTimestamp,
        qualityStatus: row.qualityStatus,
      }));
  }

  async corporateActions(input: {
    readonly instrumentId: string;
    readonly from: Date;
    readonly to: Date;
  }): Promise<readonly CorporateActionView[]> {
    const rows = await this.connection.database
      .select({
        eventKey: portfolioTransactions.externalReference,
        identity: portfolioTransactions.corporateActionIdentityHash,
        type: portfolioTransactions.type,
        effectiveAt: portfolioTransactions.tradeAt,
        factor: portfolioTransactions.quantity,
        cashAmount: portfolioTransactions.cashAmount,
      })
      .from(portfolioTransactions)
      .where(
        and(
          eq(portfolioTransactions.instrumentId, input.instrumentId),
          eq(portfolioTransactions.source, 'corporate_action'),
          eq(portfolioTransactions.status, 'posted'),
          inArray(portfolioTransactions.type, [
            'split',
            'bonusShare',
            'rightsIssue',
            'dividend',
          ]),
          gte(portfolioTransactions.tradeAt, input.from),
          lte(portfolioTransactions.tradeAt, input.to),
        ),
      )
      .orderBy(
        asc(portfolioTransactions.tradeAt),
        asc(portfolioTransactions.id),
      );
    const unique = new Map<string, CorporateActionView>();
    for (const row of rows) {
      const key = row.identity ?? row.eventKey;
      if (!key || unique.has(key)) continue;
      unique.set(key, {
        eventKey: row.eventKey ?? key,
        type: row.type as CorporateActionView['type'],
        effectiveAt: row.effectiveAt,
        factor: row.factor,
        cashAmount: row.cashAmount,
        sourceType: 'corporate_action',
      });
    }
    return [...unique.values()];
  }

  async patterns(input: {
    readonly instrumentId: string;
    readonly timeframe: string;
    readonly adjustmentMode: ChartAdjustmentMode;
    readonly from: Date;
    readonly to: Date;
    readonly limit: number;
  }) {
    const databaseMode =
      input.adjustmentMode === 'split-adjusted'
        ? 'split_adjusted'
        : input.adjustmentMode === 'total-return'
          ? 'total_return_adjusted'
          : 'raw';
    const rows = await this.connection.database
      .select()
      .from(patternInstances)
      .where(
        and(
          eq(patternInstances.instrumentId, input.instrumentId),
          eq(patternInstances.timeframe, input.timeframe),
          eq(patternInstances.adjustmentMode, databaseMode),
          gte(patternInstances.endTime, input.from),
          lte(patternInstances.endTime, input.to),
        ),
      )
      .orderBy(desc(patternInstances.detectedAt), desc(patternInstances.id))
      .limit(input.limit);
    return rows.map((row) => ({
      id: row.id,
      code: row.patternCode,
      version: row.patternVersion,
      algorithmVersion: row.algorithmVersion,
      state: row.state,
      direction: row.direction,
      startTime: row.startTime,
      endTime: row.endTime,
      detectedAt: row.detectedAt,
      dataCutoffAt: row.dataCutoffAt,
      evidenceVersion: row.evidenceVersion,
    }));
  }

  async userMarkers(input: {
    readonly userId: string;
    readonly instrumentId: string;
    readonly from: Date;
    readonly to: Date;
  }): Promise<readonly UserChartMarkerView[]> {
    const transactions = await this.connection.database
      .select({
        id: portfolioTransactions.id,
        type: portfolioTransactions.type,
        time: portfolioTransactions.tradeAt,
      })
      .from(portfolioTransactions)
      .innerJoin(
        portfolios,
        eq(portfolios.id, portfolioTransactions.portfolioId),
      )
      .where(
        and(
          eq(portfolios.userId, input.userId),
          eq(portfolioTransactions.instrumentId, input.instrumentId),
          eq(portfolioTransactions.status, 'posted'),
          gte(portfolioTransactions.tradeAt, input.from),
          lte(portfolioTransactions.tradeAt, input.to),
        ),
      );
    const triggers = await this.connection.database
      .select({
        id: alertTriggers.id,
        type: alertTriggers.triggerType,
        time: alertTriggers.occurredAt,
      })
      .from(alertTriggers)
      .innerJoin(alerts, eq(alerts.id, alertTriggers.alertId))
      .where(
        and(
          eq(alerts.ownerUserId, input.userId),
          eq(alertTriggers.instrumentId, input.instrumentId),
          gte(alertTriggers.occurredAt, input.from),
          lte(alertTriggers.occurredAt, input.to),
        ),
      );
    return [
      ...transactions.map((row) => ({
        time: row.time,
        type: 'transaction' as const,
        label: row.type,
        sourceType: 'portfolio_transaction' as const,
        sourceId: row.id,
      })),
      ...triggers.map((row) => ({
        time: row.time,
        type: 'alert' as const,
        label: row.type,
        sourceType: 'alert_trigger' as const,
        sourceId: row.id,
      })),
    ].sort((left, right) => left.time.getTime() - right.time.getTime());
  }

  async activeAlertCount(userId: string, instrumentId: string) {
    const row = (
      await this.connection.database
        .select({ count: sql<number>`count(*)::int` })
        .from(alerts)
        .innerJoin(
          alertRevisions,
          and(
            eq(alertRevisions.alertId, alerts.id),
            eq(alertRevisions.revision, alerts.currentRevision),
          ),
        )
        .where(
          and(
            eq(alerts.ownerUserId, userId),
            eq(alerts.status, 'active'),
            eq(alertRevisions.instrumentId, instrumentId),
          ),
        )
    )[0];
    return row?.count ?? 0;
  }
}

@Injectable()
export class SymbolResponseCache {
  private readonly values = new Map<
    string,
    { value: unknown; expiresAt: number }
  >();
  private hits = 0;
  private misses = 0;
  private readonly ttlMs: number;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.ttlMs = config.getOrThrow<number>('MARKET_RESPONSE_CACHE_TTL_MS');
  }

  get<T>(key: string, now = Date.now()): T | null {
    const entry = this.values.get(key);
    if (!entry || entry.expiresAt <= now) {
      if (entry) this.values.delete(key);
      this.misses += 1;
      return null;
    }
    this.hits += 1;
    return entry.value as T;
  }

  set(key: string, value: unknown, now = Date.now()) {
    if (this.values.size >= 256) {
      const first = this.values.keys().next().value;
      if (first) this.values.delete(first);
    }
    this.values.set(key, { value, expiresAt: now + this.ttlMs });
  }

  clear() {
    this.values.clear();
    this.hits = 0;
    this.misses = 0;
  }

  stats() {
    return { hits: this.hits, misses: this.misses };
  }
}
