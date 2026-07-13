import './instrument';

import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { AuthConfig } from './config/configurations/auth.config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Route Nest's framework + HTTP logs through Pino.
  app.useLogger(app.get(Logger));

  // Enable OnApplicationShutdown / OnModuleDestroy hooks (Redis, DB, queues).
  app.enableShutdownHooks();

  app.use(helmet());

  const auth = app.get(ConfigService).getOrThrow<AuthConfig>('auth');
  app.enableCors({
    origin: auth.corsOrigins.length > 0 ? auth.corsOrigins : true,
    credentials: false, // Bearer transport — no cookies, no CSRF surface
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  app.get(Logger).log(`Application listening on port ${port}`, 'Bootstrap');
}

void bootstrap();
