import { InitialAdminSeeder } from './initial-admin.seeder';
import type { Seeder } from './seeder.interface';

/** Ordered list of seeders run by `pnpm seed`. */
export const seeders: Seeder[] = [new InitialAdminSeeder()];
