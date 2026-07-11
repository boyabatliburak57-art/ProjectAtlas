import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';

export function createOpenApiDocument(
  application: INestApplication,
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Project Atlas API')
    .setDescription('Project Atlas versioned REST API')
    .setVersion('1.0')
    .build();

  return SwaggerModule.createDocument(application, config);
}

export function setupOpenApi(application: INestApplication): OpenAPIObject {
  const document = createOpenApiDocument(application);

  SwaggerModule.setup('api/v1/docs', application, document, {
    jsonDocumentUrl: 'api/v1/openapi.json',
  });

  return document;
}
