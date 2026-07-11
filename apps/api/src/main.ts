import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApplication } from './bootstrap/configure-application';

async function bootstrap(): Promise<void> {
  const application = await NestFactory.create(AppModule, { bufferLogs: true });
  const configService = application.get(ConfigService);

  configureApplication(application);

  await application.listen(
    configService.getOrThrow<number>('API_PORT'),
    configService.getOrThrow<string>('API_HOST'),
  );
}

void bootstrap();
