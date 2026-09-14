import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { ConfigModule } from '../src/config/config.module';
import type { AuthConfig } from '../src/config/configurations/auth.config';
import { AuthModule } from '../src/features/auth/auth.module';
import { TokenService } from '../src/features/auth/token.service';
import { UsersModule } from '../src/features/users/users.module';
import { UsersService } from '../src/features/users/users.service';
import { DatabaseModule } from '../src/infrastructure/database/database.module';
import { ExceptionsModule } from '../src/infrastructure/exceptions';
import { LoggerModule } from '../src/infrastructure/logger/logger.module';
import { ZodValidationPipe } from '../src/common/pipes/zod-validation.pipe';

/**
 * Auth HTTP contract e2e. Boots ConfigModule + DatabaseModule + ExceptionsModule
 * + LoggerModule + AuthModule + UsersModule + ThrottlerModule and registers the
 * global guards, so this avoids MastraModule's ESM-only dependency.
 * ExceptionsModule is required so UsersService/AuthService (which now throw via
 * ExceptionService) can resolve their dependency, and so thrown AppExceptions
 * render through the real GlobalExceptionFilter envelope; LoggerModule is
 * required because GlobalExceptionFilter injects nestjs-pino's PinoLogger.
 * Requires Postgres (schema migrated) + Redis. Run with
 * `pnpm test:e2e -- auth.e2e`.
 */
describe('Auth API (e2e)', () => {
  let app: INestApplication;
  const stamp = String(Date.now());
  const adminEmail = `admin_${stamp}@e2e.local`;
  const adminPass = 'admin-e2e-password-123';
  let adminAccess: string;
  let userEmail: string;
  let userAccess: string;
  let userRefresh: string;
  let userId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        DatabaseModule,
        ExceptionsModule,
        LoggerModule,
        ThrottlerModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (c: ConfigService) => {
            const a = c.getOrThrow<AuthConfig>('auth');
            return [{ ttl: a.throttleTtl * 1000, limit: 10_000 }]; // high, avoid flakiness
          },
        }),
        AuthModule,
        UsersModule,
      ],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    // Bootstrap the first admin directly (bypasses the admin-only guard).
    await app.get(UsersService).create({
      email: adminEmail,
      password: adminPass,
      role: 'admin',
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  const server = () => app.getHttpServer();

  it('rejects unauthenticated access to a protected route', async () => {
    const res = await request(server()).get('/users').expect(401);
    // Not merely 401: the code is the contract. The browser client refreshes on
    // AUTH_TOKEN_EXPIRED and only on that, so a missing token must NOT wear it.
    expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('logs the admin in and returns a token pair', async () => {
    const res = await request(server())
      .post('/auth/login')
      .send({ email: adminEmail, password: adminPass })
      .expect(200);
    expect(res.body.accessToken).toBeDefined();
    adminAccess = res.body.accessToken;
  });

  it('lets the admin create a user', async () => {
    userEmail = `user_${stamp}@e2e.local`;
    const res = await request(server())
      .post('/users')
      .set('Authorization', `Bearer ${adminAccess}`)
      .send({
        email: userEmail,
        password: 'user-e2e-password-123',
        role: 'user',
      })
      .expect(201);
    expect(res.body.passwordHash).toBeUndefined();
    expect(res.body.role).toBe('user');
  });

  it('lets the new user log in', async () => {
    const res = await request(server())
      .post('/auth/login')
      .send({ email: userEmail, password: 'user-e2e-password-123' })
      .expect(200);
    userAccess = res.body.accessToken;
    userRefresh = res.body.refreshToken;
  });

  it('exposes /auth/me with the resolved principal', async () => {
    const res = await request(server())
      .get('/auth/me')
      .set('Authorization', `Bearer ${userAccess}`)
      .expect(200);
    expect(res.body.role).toBe('user');
    userId = res.body.id;
  });

  it('reports an expired access token as AUTH_TOKEN_EXPIRED, not a bare 401', async () => {
    // Signed through the real TokenService, so the secret, issuer and audience
    // are all correct and expiry is the ONLY thing wrong with this token.
    const expired = app
      .get(TokenService)
      .signAccessToken(
        { sub: userId, role: 'user', kind: 'user', sid: 'expired-e2e' },
        -60,
      );

    const res = await request(server())
      .get('/auth/me')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);

    // The whole point of the test. This used to come back as the generic
    // UNAUTHORIZED, which the client does not treat as refreshable — so every
    // session died silently once its 15-minute access token aged out.
    expect(res.body.error.code).toBe('AUTH_TOKEN_EXPIRED');
  });

  it('reports a token signed with the wrong secret as AUTH_TOKEN_INVALID', async () => {
    // The counterpart: a forged token must not be reported as recoverable, or
    // the client would burn its refresh token retrying.
    const [header, payload] = userAccess.split('.');
    const forged = `${header}.${payload}.${'A'.repeat(43)}`;

    const res = await request(server())
      .get('/auth/me')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);
    expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('forbids a non-admin from the admin route', async () => {
    await request(server())
      .get('/users')
      .set('Authorization', `Bearer ${userAccess}`)
      .expect(403);
  });

  it('rotates the refresh token and detects reuse', async () => {
    const rotated = await request(server())
      .post('/auth/refresh')
      .send({ refreshToken: userRefresh })
      .expect(200);
    expect(rotated.body.refreshToken).not.toBe(userRefresh);

    // Replaying the now-revoked original token must fail (reuse detection).
    await request(server())
      .post('/auth/refresh')
      .send({ refreshToken: userRefresh })
      .expect(401);
  });

  it('issues an agent token from a service credential', async () => {
    const created = await request(server())
      .post('/service-credentials')
      .set('Authorization', `Bearer ${adminAccess}`)
      .send({ name: 'e2e-agent' })
      .expect(201);
    expect(created.body.apiKey).toMatch(/^svc_/);

    const token = await request(server())
      .post('/auth/service-token')
      .send({ apiKey: created.body.apiKey })
      .expect(200);

    const me = await request(server())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token.body.accessToken}`)
      .expect(200);
    expect(me.body.role).toBe('agent');
  });
});
