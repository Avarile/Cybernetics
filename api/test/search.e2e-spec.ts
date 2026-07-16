import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { ConfigModule } from '../src/config/config.module';
import type { AuthConfig } from '../src/config/configurations/auth.config';
import { AuthModule } from '../src/features/auth/auth.module';
import { SearchServiceModule } from '../src/features/search-service/search-service.module';
import { UsersModule } from '../src/features/users/users.module';
import { UsersService } from '../src/features/users/users.service';
import { DatabaseModule } from '../src/infrastructure/database/database.module';
import { ExceptionsModule } from '../src/infrastructure/exceptions';
import { LoggerModule } from '../src/infrastructure/logger/logger.module';
import { QueueModule } from '../src/infrastructure/queue/queue.module';
import { SearchEngineModule } from '../src/infrastructure/search-engine/search-engine.module';

/**
 * Search data-processor e2e. Boots a focused module subset (never AppModule) to
 * avoid the Mastra ESM/Jest break. Requires Postgres + Redis + MeiliSearch.
 * Run with `pnpm test:e2e -- search.e2e`.
 */
describe('Search Management API (e2e)', () => {
  let app: INestApplication;
  const stamp = String(Date.now());
  const collection = `articles_${stamp}`;
  const adminEmail = `search_admin_${stamp}@e2e.local`;
  const userEmail = `search_user_${stamp}@e2e.local`;
  const pass = 'search-e2e-password-123';
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        DatabaseModule,
        ExceptionsModule,
        LoggerModule,
        QueueModule,
        SearchEngineModule,
        ThrottlerModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (c: ConfigService) => {
            const a = c.getOrThrow<AuthConfig>('auth');
            return [{ ttl: a.throttleTtl * 1000, limit: 10_000 }];
          },
        }),
        AuthModule,
        UsersModule,
        SearchServiceModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    const users = app.get(UsersService);
    await users.create({ email: adminEmail, password: pass, role: 'admin' });
    await users.create({ email: userEmail, password: pass, role: 'user' });

    const login = async (email: string) =>
      (
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email, password: pass })
          .expect(200)
      ).body.accessToken;
    adminToken = await login(adminEmail);
    userToken = await login(userEmail);
  });

  afterAll(async () => {
    await app?.close();
  });

  const server = () => app.getHttpServer();
  const asAdmin = (r: request.Test) => r.set('Authorization', `Bearer ${adminToken}`);
  const asUser = (r: request.Test) => r.set('Authorization', `Bearer ${userToken}`);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('rejects unauthenticated collection creation', async () => {
    await request(server()).post('/search/collections').send({}).expect(401);
  });

  it('forbids a non-admin from creating a collection', async () => {
    await asUser(request(server()).post('/search/collections'))
      .send({
        name: collection,
        displayName: 'Articles',
        fields: [{ name: 'title', type: 'string', searchable: true }],
      })
      .expect(403);
  });

  it('lets an admin create a collection', async () => {
    await asAdmin(request(server()).post('/search/collections'))
      .send({
        name: collection,
        displayName: 'Articles',
        fields: [
          { name: 'title', type: 'string', required: true, searchable: true, sortable: true },
          { name: 'status', type: 'string', filterable: true, enum: ['draft', 'live'] },
        ],
      })
      .expect(201);
  });

  it('rejects an invalid field-spec (no searchable field)', async () => {
    await asAdmin(request(server()).post('/search/collections'))
      .send({
        name: `bad_${stamp}`,
        displayName: 'Bad',
        fields: [{ name: 'n', type: 'number', filterable: true }],
      })
      .expect(400);
  });

  it('forbids a non-admin from persisting records', async () => {
    await asUser(request(server()).post(`/search/collections/${collection}/records`))
      .send({ records: [{ document: { title: 'x' } }] })
      .expect(403);
  });

  it('400s a document that fails validation', async () => {
    await asAdmin(request(server()).post(`/search/collections/${collection}/records`))
      .send({ records: [{ document: { title: 123 } }] })
      .expect(400);
  });

  it('persists records (202) and makes them queryable after indexing', async () => {
    await asAdmin(request(server()).post(`/search/collections/${collection}/records`))
      .send({
        records: [
          { externalId: 'a1', document: { title: 'Hello world', status: 'live' } },
          { externalId: 'a2', document: { title: 'Draft note', status: 'draft' } },
        ],
      })
      .expect(202);

    // Indexing is async; poll briefly for eventual consistency.
    let hits = 0;
    for (let i = 0; i < 20 && hits === 0; i++) {
      await sleep(250);
      const res = await asUser(
        request(server()).post(`/search/collections/${collection}/query`),
      ).send({ q: 'hello' });
      if (res.status === 200) hits = res.body.totalHits;
    }
    expect(hits).toBeGreaterThan(0);
  });

  it('lets a user filter on an allowlisted field', async () => {
    const res = await asUser(
      request(server()).post(`/search/collections/${collection}/query`),
    )
      .send({ q: '', filters: { status: 'live' } })
      .expect(200);
    expect(res.body.hits.every((h: { status: string }) => h.status === 'live')).toBe(true);
  });

  it('rejects a filter on a non-allowlisted field', async () => {
    await asUser(request(server()).post(`/search/collections/${collection}/query`))
      .send({ q: '', filters: { title: 'x' } })
      .expect(400);
  });

  it('404s querying an unknown collection', async () => {
    await asUser(request(server()).post('/search/collections/does_not_exist/query'))
      .send({ q: 'x' })
      .expect(404);
  });

  it('lets an admin reload a collection', async () => {
    await asAdmin(request(server()).post(`/search/collections/${collection}/reload`)).expect(202);
  });

  it('forbids a non-admin from reloading', async () => {
    await asUser(request(server()).post(`/search/collections/${collection}/reload`)).expect(403);
  });
});
