import type { Server } from 'node:http';

import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppModule } from './app.module';
import { configureApplication } from './bootstrap/configure-application';

const healthResponseSchema = z.object({
  data: z.object({
    status: z.enum(['live', 'not_ready', 'ready', 'started']),
  }),
  meta: z.object({ requestId: z.string() }),
});

const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
});

const openApiResponseSchema = z.object({
  info: z.object({ version: z.string() }),
  paths: z.record(z.string(), z.unknown()),
});

function getHttpServer(application: INestApplication): Server {
  const server: unknown = application.getHttpServer();
  return server as Server;
}

@Controller('test-only')
class TestErrorController {
  @Get('unexpected-error')
  unexpectedError(): never {
    throw new Error('sensitive internal detail');
  }
}

describe('API scaffold', () => {
  let application: INestApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    process.env.ATLAS_ENV = 'test';

    const moduleReference = await Test.createTestingModule({
      controllers: [TestErrorController],
      imports: [AppModule],
    }).compile();

    application = moduleReference.createNestApplication();
    configureApplication(application);
    await application.init();
  });

  afterAll(async () => {
    await application.close();
  });

  it('serves separate liveness and readiness probes', async () => {
    const liveResponse = await request(getHttpServer(application))
      .get('/health/live')
      .expect(200);
    const readyResponse = await request(getHttpServer(application))
      .get('/health/ready')
      .expect(200);
    const liveBody = healthResponseSchema.parse(liveResponse.body);
    const readyBody = healthResponseSchema.parse(readyResponse.body);

    expect(liveBody.data.status).toBe('live');
    expect(readyBody.data).toEqual({ status: 'ready' });

    const startupResponse = await request(getHttpServer(application))
      .get('/health/startup')
      .expect(200);
    expect(healthResponseSchema.parse(startupResponse.body).data.status).toBe(
      'started',
    );
  });

  it('propagates a safe request and correlation id', async () => {
    const response = await request(getHttpServer(application))
      .get('/health/live')
      .set('x-request-id', 'request_12345678')
      .set('x-correlation-id', 'correlation_12345678')
      .set(
        'traceparent',
        '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      )
      .expect(200);
    const body = healthResponseSchema.parse(response.body);

    expect(response.headers['x-request-id']).toBe('request_12345678');
    expect(response.headers['x-correlation-id']).toBe('correlation_12345678');
    expect(response.headers['traceparent']).toMatch(
      /^00-4bf92f3577b34da6a3ce929d0e0e4736-[a-f0-9]{16}-01$/u,
    );
    expect(body.meta.requestId).toBe('request_12345678');
  });

  it('exports bounded platform metrics without request identifiers', async () => {
    const response = await request(getHttpServer(application))
      .get('/metrics')
      .expect(200);

    expect(response.text).toContain('atlas_http_server_requests_total');
    expect(response.text).toContain('atlas_process_memory_bytes');
    expect(response.text).not.toContain('request_12345678');
    expect(response.text).not.toContain('correlation_12345678');
  });

  it('returns the standard error envelope without a stack trace', async () => {
    const response = await request(getHttpServer(application))
      .get('/api/v1/not-found')
      .expect(404);
    const body = errorResponseSchema.parse(response.body);

    expect(body).toMatchObject({
      error: {
        code: 'HTTP_404',
        message: 'Cannot GET /api/v1/not-found',
      },
    });
    expect(body.error.requestId).toEqual(expect.any(String));
    expect(body.error).not.toHaveProperty('stack');
  });

  it('hides unexpected error details in production responses', async () => {
    const response = await request(getHttpServer(application))
      .get('/api/v1/test-only/unexpected-error')
      .expect(500);
    const body = errorResponseSchema.parse(response.body);

    expect(body.error).toMatchObject({
      code: 'HTTP_500',
      message: 'Beklenmeyen bir hata oluştu.',
    });
    expect(JSON.stringify(body)).not.toContain('sensitive internal detail');
    expect(body.error).not.toHaveProperty('stack');
  });

  it('serves generated OpenAPI JSON from the versioned API path', async () => {
    const response = await request(getHttpServer(application))
      .get('/api/v1/openapi.json')
      .expect(200);
    const body = openApiResponseSchema.parse(response.body);

    expect(body.info.version).toBe('1.0');
    expect(body.paths['/health/live']).toBeDefined();
  });
});
