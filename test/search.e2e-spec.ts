import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ConfigModule } from '../src/config/config.module';
import { QueueModule } from '../src/infrastructure/queue/queue.module';
import { SearchEngineModule } from '../src/infrastructure/search-engine/search-engine.module';
import { SearchServiceModule } from '../src/features/search-service/search-service.module';

/**
 * Search HTTP contract e2e. Boots a focused module set (ConfigModule +
 * QueueModule + SearchEngineModule + SearchServiceModule) instead of the full
 * AppModule, so this avoids pulling in MastraModule — whose
 * `@sindresorhus/slugify` dependency is ESM-only and cannot be transformed by
 * Jest's default config. This mirrors the pattern in `queue.e2e-spec.ts`.
 *
 * This still wires the real SearchController + SearchService: the MeiliSearch
 * client is a lazy HTTP client (no connection at boot) and
 * `SearchService.onApplicationBootstrap` is a no-op against the empty index
 * registry, so Meili/Postgres/MinIO are not required to boot. QueueModule
 * (BullMQ) does require a reachable Redis (see the REDIS_* vars in `.env`).
 *
 * The app registry is empty for now, so this asserts the contract: validation
 * + unknown-index handling. Run with `pnpm test:e2e -- search.e2e`.
 */
describe('Search API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        QueueModule,
        SearchEngineModule,
        SearchServiceModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('404s on an unknown index', async () => {
    const res = await request(app.getHttpServer())
      .post('/search/does-not-exist')
      .send({ q: 'hello' });
    expect(res.status).toBe(404);
  });

  it('400s on an invalid body', async () => {
    const res = await request(app.getHttpServer())
      .post('/search/does-not-exist')
      .send({ page: -1 });
    expect(res.status).toBe(400);
  });
});
