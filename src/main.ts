import './instrument';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Route Nest's framework + HTTP logs through Pino.
  app.useLogger(app.get(Logger));

  // Enable OnApplicationShutdown / OnModuleDestroy hooks (Redis, DB, queues).
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  app.get(Logger).log(`Application listening on port ${port}`, 'Bootstrap');
}

void bootstrap();
