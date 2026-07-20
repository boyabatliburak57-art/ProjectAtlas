import 'reflect-metadata';

import { Test } from '@nestjs/testing';
import type { Request } from 'express';

import { AppModule } from '../app.module';
import { configureApplication } from '../bootstrap/configure-application';
import {
  AUTHENTICATED_USER_RESOLVER,
  type AuthenticatedUserResolver,
} from '../common/auth/authenticated-user';

async function main() {
  const resolver: AuthenticatedUserResolver = (request: Request) => {
    const value = request.headers['x-performance-user-id'];
    if (typeof value !== 'string') throw new Error('Performance user required');
    return value;
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AUTHENTICATED_USER_RESOLVER)
    .useValue(resolver)
    .compile();
  const application = module.createNestApplication({ logger: false });
  configureApplication(application);
  await application.listen(
    Number(process.env.API_PORT ?? 43108),
    process.env.API_HOST ?? '127.0.0.1',
  );
  const close = () => void application.close().finally(() => process.exit(0));
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
