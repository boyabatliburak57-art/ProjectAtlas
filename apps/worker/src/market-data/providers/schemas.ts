import { z } from 'zod';

import { MARKET_DATA_TIMEFRAMES } from './contracts';
import { compareDecimalStrings } from './decimal';

const providerCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const providerSymbolSchema = z.string().trim().min(1).max(64);
const decimalStringSchema = z.string().regex(/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/);
const nonNegativeDecimalStringSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const providerDateSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value));

export const marketDataTimeframeSchema = z.enum(MARKET_DATA_TIMEFRAMES);

export const providerCapabilitiesSchema = z.strictObject({
  supportedTimeframes: z.array(marketDataTimeframeSchema).min(1),
  dataMode: z.enum(['delayed', 'realtime', 'end-of-day']),
  historicalDepthDays: z.number().int().positive().nullable(),
  supportsCorporateActions: z.boolean(),
  supportsFundamentals: z.boolean(),
  supportsPagination: z.boolean(),
  rateLimit: z
    .strictObject({
      requests: z.number().int().positive(),
      intervalMs: z.number().int().positive(),
    })
    .nullable(),
});

export const providerInstrumentSchema = z.strictObject({
  providerSymbol: providerSymbolSchema,
  symbol: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(256),
  marketCode: z.string().trim().min(1).max(32),
  currencyCode: z.string().trim().length(3).toUpperCase(),
  isin: z.string().trim().length(12).optional(),
});

export const providerInstrumentListSchema = z.array(providerInstrumentSchema);

export const providerBarSchema = z
  .strictObject({
    providerSymbol: providerSymbolSchema,
    timeframe: marketDataTimeframeSchema,
    openTime: providerDateSchema,
    closeTime: providerDateSchema,
    open: decimalStringSchema,
    high: decimalStringSchema,
    low: decimalStringSchema,
    close: decimalStringSchema,
    volume: nonNegativeDecimalStringSchema,
    isClosed: z.boolean(),
    sourceTimestamp: providerDateSchema.optional(),
  })
  .superRefine((bar, context) => {
    if (bar.closeTime <= bar.openTime) {
      context.addIssue({
        code: 'custom',
        message: 'closeTime must be after openTime',
        path: ['closeTime'],
      });
    }

    const prices = [bar.open, bar.close, bar.low];
    if (prices.some((price) => compareDecimalStrings(bar.high, price) < 0)) {
      context.addIssue({
        code: 'custom',
        message: 'high must be greater than or equal to all prices',
        path: ['high'],
      });
    }

    const upperPrices = [bar.open, bar.close, bar.high];
    if (
      upperPrices.some((price) => compareDecimalStrings(bar.low, price) > 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'low must be less than or equal to all prices',
        path: ['low'],
      });
    }
  });

export const providerBarBatchSchema = z.strictObject({
  bars: z.array(providerBarSchema),
  nextCursor: z.string().min(1).optional(),
});

export const fetchBarsRequestSchema = z
  .strictObject({
    providerSymbol: providerSymbolSchema,
    timeframe: marketDataTimeframeSchema,
    from: z.date(),
    to: z.date(),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(10_000).optional(),
  })
  .refine((request) => request.to > request.from, {
    message: 'to must be after from',
    path: ['to'],
  });

export function parseProviderCode(value: string): string {
  return providerCodeSchema.parse(value);
}
