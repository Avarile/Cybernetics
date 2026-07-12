import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Search HTTP contract e2e. Boots AppModule (requires Postgres, Redis, MinIO,
 * and MeiliSearch reachable per `.env`). The app registry is empty for now, so
 * this asserts the contract: validation + unknown-index handling.
 * Run with `pnpm test:e2e -- search.e2e`.
 */
describe('Search API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
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
