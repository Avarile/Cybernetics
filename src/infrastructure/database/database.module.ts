import {
  Global,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
  type Provider,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { AppConfig } from '../../config/configurations/app.config';
import type { DatabaseConfig } from '../../config/configurations/database.config';
import { DRIZZLE, PG_POOL } from './drizzle.constants';
import * as schema from './schema';

/** Builds the pg connection pool from validated config. */
const pgPoolProvider: Provider = {
  provide: PG_POOL,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Pool => {
    const db = config.getOrThrow<DatabaseConfig>('database');
    return new Pool({
      host: db.host,
      port: db.port,
      user: db.username,
      password: db.password,
      database: db.database,
      ssl: db.ssl ? { rejectUnauthorized: false } : false,
    });
  },
};

/** The typed Drizzle instance, backed by the shared pool. */
const drizzleProvider: Provider = {
  provide: DRIZZLE,
  inject: [PG_POOL, ConfigService],
  useFactory: (pool: Pool, config: ConfigService) => {
    const app = config.getOrThrow<AppConfig>('app');
    const db = config.getOrThrow<DatabaseConfig>('database');
    return drizzle(pool, { schema, logger: db.logging && !app.isProduction });
  },
};

/** Closes the pool on graceful shutdown (mirrors RedisClientLifecycle). */
@Injectable()
class DatabaseConnection implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Establishes the Drizzle/PostgreSQL connection for the running application.
 * Services inject the `DRIZZLE` token (typed `DrizzleDB`) — or extend
 * `BaseRepository` — to query. `PG_POOL` is exported for low-level needs
 * (health check).
 */
@Global()
@Module({
  providers: [pgPoolProvider, drizzleProvider, DatabaseConnection],
  exports: [DRIZZLE, PG_POOL],
})
export class DatabaseModule {}
