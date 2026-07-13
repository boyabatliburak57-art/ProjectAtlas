import type { Server } from 'node:http';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IndicatorRegistry, smaDefinition } from '@atlas/domain';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppModule } from '../app.module';
import { configureApplication } from '../bootstrap/configure-application';
import { INDICATOR_REGISTRY } from './indicator-catalog.service';

const catalogItemSchema = z.object({
  code: z.string(),
  version: z.number().int().positive(),
  name: z.string(),
  category: z.enum(['price', 'momentum', 'trend', 'volatility', 'volume']),
  status: z.literal('enabled'),
  parameters: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()),
});

const listResponseSchema = z.object({
  data: z.object({
    items: z.array(catalogItemSchema),
    total: z.number().int().nonnegative(),
  }),
  meta: z.object({ requestId: z.string().min(1) }),
});

const detailResponseSchema = z.object({
  data: z.object({
    code: z.string(),
    name: z.string(),
    category: z.string(),
    defaultVersion: z.number().int().positive(),
    versions: z.array(catalogItemSchema),
  }),
  meta: z.object({ requestId: z.string().min(1) }),
});

const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
});

function server(application: INestApplication): Server {
  return application.getHttpServer() as Server;
}

describe('Indicator Catalog API', () => {
  let application: INestApplication;

  beforeAll(async () => {
    const moduleReference = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    application = moduleReference.createNestApplication();
    configureApplication(application);
    await application.init();
  });

  afterAll(async () => application.close());

  it('lists all public definitions with contract metadata', async () => {
    const response = await request(server(application))
      .get('/api/v1/indicators')
      .expect(200);
    const body = listResponseSchema.parse(response.body);

    expect(body.data.total).toBe(22);
    expect(body.data.items).toHaveLength(22);
    expect(new Set(body.data.items.map(({ code }) => code)).size).toBe(22);
    expect(body.data.items.find(({ code }) => code === 'MACD')).toMatchObject({
      output: { type: 'multi-series' },
      parameters: { type: 'object' },
    });
  });

  it('applies category, status and case-insensitive search filters', async () => {
    const momentum = listResponseSchema.parse(
      (
        await request(server(application))
          .get('/api/v1/indicators?category=momentum')
          .expect(200)
      ).body,
    );
    const searched = listResponseSchema.parse(
      (
        await request(server(application))
          .get('/api/v1/indicators?search=ReLaTiVe')
          .expect(200)
      ).body,
    );
    const disabled = listResponseSchema.parse(
      (
        await request(server(application))
          .get('/api/v1/indicators?status=disabled')
          .expect(200)
      ).body,
    );

    expect(momentum.data.items).toHaveLength(7);
    expect(
      momentum.data.items.every(({ category }) => category === 'momentum'),
    ).toBe(true);
    expect(searched.data.items.map(({ code }) => code)).toEqual([
      'RELATIVE_VOLUME',
      'RSI',
    ]);
    expect(disabled.data).toEqual({ items: [], total: 0 });
  });

  it('returns supported and default versions for a case-insensitive code', async () => {
    const response = await request(server(application))
      .get('/api/v1/indicators/rsi')
      .expect(200);
    const body = detailResponseSchema.parse(response.body);

    expect(body.data).toMatchObject({
      code: 'RSI',
      defaultVersion: 1,
    });
    expect(body.data.versions).toHaveLength(1);
  });

  it('returns safe errors for invalid filters and unknown codes', async () => {
    const invalid = errorSchema.parse(
      (
        await request(server(application))
          .get('/api/v1/indicators?category=unknown')
          .expect(400)
      ).body,
    );
    const missing = errorSchema.parse(
      (
        await request(server(application))
          .get('/api/v1/indicators/unknown')
          .expect(404)
      ).body,
    );

    expect(invalid.error.code).toBe('INDICATOR_CATALOG_FILTER_INVALID');
    expect(missing.error.code).toBe('INDICATOR_NOT_FOUND');
  });
});

describe('disabled indicator visibility', () => {
  let application: INestApplication;

  beforeAll(async () => {
    const registry = new IndicatorRegistry().register(smaDefinition, {
      enabled: false,
    });
    const moduleReference = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(INDICATOR_REGISTRY)
      .useValue(registry)
      .compile();
    application = moduleReference.createNestApplication();
    configureApplication(application);
    await application.init();
  });

  afterAll(async () => application.close());

  it('does not expose a disabled definition in list or detail', async () => {
    const list = listResponseSchema.parse(
      (await request(server(application)).get('/api/v1/indicators').expect(200))
        .body,
    );
    const detail = errorSchema.parse(
      (
        await request(server(application))
          .get('/api/v1/indicators/SMA')
          .expect(404)
      ).body,
    );

    expect(list.data).toEqual({ items: [], total: 0 });
    expect(detail.error.code).toBe('INDICATOR_NOT_FOUND');
  });
});
