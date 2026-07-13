import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';
import { configureApplication } from '../bootstrap/configure-application';
import { createOpenApiDocument } from './openapi';

describe('OpenAPI document', () => {
  let application: INestApplication;

  beforeAll(async () => {
    const moduleReference = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    application = moduleReference.createNestApplication();
    configureApplication(application);
    await application.init();
  });

  afterAll(async () => {
    await application.close();
  });

  it('contains health, indicator and scanner runtime operations', () => {
    const document = createOpenApiDocument(application);

    expect(document.info.version).toBe('1.0');
    expect(document.paths['/health/live']?.get).toBeDefined();
    expect(document.paths['/health/ready']?.get).toBeDefined();
    expect(document.paths['/api/v1/indicators']?.get).toBeDefined();
    expect(document.paths['/api/v1/indicators/{code}']?.get).toBeDefined();
    expect(document.paths['/api/v1/scanner/runs']?.post).toBeDefined();
    expect(document.paths['/api/v1/scanner/runs/{runId}']?.get).toBeDefined();
    expect(
      document.paths['/api/v1/scanner/runs/{runId}/results']?.get,
    ).toBeDefined();
    expect(
      document.paths['/api/v1/scanner/runs/{runId}/cancel']?.post,
    ).toBeDefined();
    const listParameters =
      document.paths['/api/v1/indicators']?.get?.parameters;
    expect(JSON.stringify(listParameters)).toContain('category');
    expect(JSON.stringify(listParameters)).toContain('search');
    expect(JSON.stringify(listParameters)).toContain('status');
    const createParameters =
      document.paths['/api/v1/scanner/runs']?.post?.parameters;
    expect(JSON.stringify(createParameters)).toContain('Idempotency-Key');
    expect(
      document.paths['/api/v1/scanner/runs']?.post?.responses,
    ).toHaveProperty('200');
    expect(
      document.paths['/api/v1/scanner/runs']?.post?.responses,
    ).toHaveProperty('201');
    const resultParameters =
      document.paths['/api/v1/scanner/runs/{runId}/results']?.get?.parameters;
    expect(JSON.stringify(resultParameters)).toContain('cursor');
    expect(JSON.stringify(resultParameters)).toContain('includeExplanation');
    expect(document.components?.securitySchemes).toHaveProperty('bearer');
  });
});
