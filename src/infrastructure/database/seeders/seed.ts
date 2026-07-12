import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { validateEnv } from '../../../config/env.validation';
import * as schema from '../schema';
import { seeders } from './index';

/**
 * Seed runner (`pnpm seed`). Builds a standalone pool + Drizzle instance, runs
 * every registered seeder in order, then closes the pool.
 */
async function runSeeders(): Promise<void> {
  loadEnv();
  const env = validateEnv(process.env);
  const pool = new Pool({
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    user: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    database: env.DATABASE_NAME,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
  });
  const db = drizzle(pool, { schema });

  try {
    if (seeders.length === 0) {
      // eslint-disable-next-line no-console
      console.log('No seeders registered — nothing to seed.');
      return;
    }
    for (const seeder of seeders) {
      // eslint-disable-next-line no-console
      console.log(`Seeding: ${seeder.name}`);
      await seeder.run(db);
    }
    // eslint-disable-next-line no-console
    console.log('Seeding complete.');
  } finally {
    await pool.end();
  }
}

runSeeders().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Seeding failed:', error);
  process.exit(1);
});
