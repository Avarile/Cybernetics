import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * End-to-end smoke test.
 *
 * Requires a running PostgreSQL and Redis (see `.env.example`), since booting
 * `AppModule` establishes those connections. Run with `pnpm test:e2e`.
 */
describe('AppModule (e2e)', () => {
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

  it('GET /health returns a health-check payload', async () => {
    const server = app.getHttpServer();
    const response = await request(server).get('/health');
    expect([200, 503]).toContain(response.status);
    expect(response.body).toHaveProperty('status');
  });
});
