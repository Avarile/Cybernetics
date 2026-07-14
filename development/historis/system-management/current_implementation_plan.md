# System Records Module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin-only NestJS module that manages runtime system configuration — SMTP/IMAP profiles, outbound 3rd-party integration credentials, generic key/value settings — with encrypted-at-rest secrets and an append-only audit log.

**Architecture:** A feature module (`src/features/system/`) with one repository + service + controller per resource, following the existing `users` feature layout. Secrets are AES-256-GCM encrypted by a new reusable `EncryptionService` (`src/infrastructure/crypto/`). Admin access is enforced by the existing global `RolesGuard` via `@Roles('admin')`. Settings reads go through the global cache-manager. All mutations emit an audit record.

**Tech Stack:** NestJS 11, Drizzle ORM (node-postgres), Zod (`ZodValidationPipe`), `@nestjs/cache-manager` (Redis/Keyv), `node:crypto` (AES-256-GCM), `nodemailer` (SMTP verify), `node:tls` (IMAP smoke test). Tests: Jest + `@swc/jest` (unit, colocated `*.spec.ts`), Supertest (e2e, module-subset boot).

## Global Constraints

- Files stay under 500 lines; keep files focused (one responsibility each).
- Validate all input at the HTTP boundary with Zod DTOs (`ZodValidationPipe`).
- Never commit secrets/credentials/.env. No `Co-Authored-By` trailer on commits (`.claude/settings.json` has no `attribution.commit`).
- Secrets are stored only as the encrypted envelope — no plaintext or ciphertext ever appears in an API response, log line, or audit `metadata`.
- Soft-delete convention: `isDeleted`/`deletedAt` from `baseColumns`; queries filter `is_deleted = false`.
- DI tokens: `DRIZZLE` (typed `DrizzleDB`), `CACHE_MANAGER` (typed `Cache` from `cache-manager`). `DatabaseModule` and `CacheModule` are both `@Global`.
- Unit tests run with `pnpm test` (rootDir `src`, regex `.*\.spec\.ts$`). e2e runs with `pnpm test:e2e` (needs Postgres + Redis on the `.env` ports and a migrated schema).
- Migrations are generated with `pnpm db:generate` (drizzle-kit reads the schema barrel `src/infrastructure/database/schema/index.ts`) and applied with `pnpm db:migrate`.
- Follow existing patterns: `PublicUser`-style projections, `ParseUUIDPipe`, `@HttpCode(204)` on delete, `registerAs` config namespaces validated by the central `envSchema`.

---

## Task Overview

1. **Encryption primitive + system config/env** — reusable `EncryptionService`, `CryptoModule`, `SYSTEM_ENCRYPTION_KEY`.
2. **Database schema + migration** — 5 tables, 2 enums, indexes, generated migration.
3. **Audit foundation + SystemModule skeleton** — audit repo/service/controller, shared `list-query` DTO, register in `AppModule`.
4. **SMTP configs** — repo, service, tester (`nodemailer`), DTOs, controller.
5. **IMAP configs** — repo, service, tester (`node:tls`), DTOs, controller.
6. **Integration credentials** — repo, service, DTOs, controller.
7. **System settings** — repo, cached service with typed getters, DTOs, controller.
8. **Build + typecheck + full unit verification.**
9. **e2e** — authz matrix, secret redaction, single-active enforcement, settings CRUD.

---

## Task 1: Encryption primitive + system config/env

**Files:**
- Modify: `src/config/env.validation.ts` (add env vars + prod guard)
- Create: `src/config/configurations/system.config.ts`
- Modify: `src/config/config.module.ts` (register `systemConfig`)
- Create: `src/infrastructure/crypto/encryption.service.ts`
- Create: `src/infrastructure/crypto/crypto.module.ts`
- Test: `src/infrastructure/crypto/encryption.service.spec.ts`

**Interfaces:**
- Produces:
  - `SystemConfig = { encryptionKey: string; encryptionKeyVersion: number }` (namespace `'system'`).
  - `class EncryptionService { encrypt(plaintext: string): string; decrypt(envelope: string): string }` — exported by `CryptoModule`.
  - Envelope format: `v{version}.{ivB64}.{tagB64}.{ciphertextB64}`.

- [ ] **Step 1: Write the failing test**

Create `src/infrastructure/crypto/encryption.service.spec.ts`:

```ts
import { EncryptionService } from './encryption.service';

/** ConfigService stub returning a fixed 32-byte key. */
function makeService(keyB64 = Buffer.alloc(32, 7).toString('base64'), version = 1) {
  const config = {
    getOrThrow: () => ({ encryptionKey: keyB64, encryptionKeyVersion: version }),
  } as any;
  return new EncryptionService(config);
}

describe('EncryptionService', () => {
  it('round-trips a plaintext through encrypt/decrypt', () => {
    const svc = makeService();
    const secret = 'sup3r-secret-smtp-password';
    const envelope = svc.encrypt(secret);
    expect(envelope).not.toContain(secret);
    expect(envelope.startsWith('v1.')).toBe(true);
    expect(svc.decrypt(envelope)).toBe(secret);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const svc = makeService();
    expect(svc.encrypt('same')).not.toBe(svc.encrypt('same'));
  });

  it('throws when the ciphertext is tampered with', () => {
    const svc = makeService();
    const env = svc.encrypt('secret');
    const parts = env.split('.');
    const ct = Buffer.from(parts[3], 'base64');
    ct[0] ^= 0xff; // flip a bit
    parts[3] = ct.toString('base64');
    expect(() => svc.decrypt(parts.join('.'))).toThrow();
  });

  it('rejects a malformed envelope', () => {
    const svc = makeService();
    expect(() => svc.decrypt('not-an-envelope')).toThrow();
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => makeService(Buffer.alloc(16).toString('base64'))).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- encryption.service`
Expected: FAIL — `Cannot find module './encryption.service'`.

- [ ] **Step 3: Add env vars + prod guard**

In `src/config/env.validation.ts`, add these keys inside the `z.object({ ... })` (near the Auth/Security block):

```ts
    // System module (secret encryption at rest)
    SYSTEM_ENCRYPTION_KEY: z
      .string()
      .default('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='), // 32 zero-bytes (dev/test only)
    SYSTEM_ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive().default(1),
```

Then add this block inside the existing `.superRefine((env, ctx) => { ... })`:

```ts
    // Require a real 32-byte encryption key in production.
    if (env.NODE_ENV === 'production') {
      let keyBytes = 0;
      try {
        keyBytes = Buffer.from(env.SYSTEM_ENCRYPTION_KEY, 'base64').length;
      } catch {
        keyBytes = 0;
      }
      if (keyBytes !== 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SYSTEM_ENCRYPTION_KEY'],
          message:
            'SYSTEM_ENCRYPTION_KEY must be a base64-encoded 32-byte key when NODE_ENV=production.',
        });
      }
    }
```

- [ ] **Step 4: Create the config namespace**

Create `src/config/configurations/system.config.ts`:

```ts
import { registerAs } from '@nestjs/config';
import { validateEnv } from '../env.validation';

/**
 * Namespaced config for the system-records module. Currently just the secret
 * encryption key + its version (used by EncryptionService). Kept in env — not
 * the DB — because it protects the DB-stored secrets.
 */
export const systemConfig = registerAs('system', () => {
  const env = validateEnv(process.env);
  return {
    encryptionKey: env.SYSTEM_ENCRYPTION_KEY,
    encryptionKeyVersion: env.SYSTEM_ENCRYPTION_KEY_VERSION,
  };
});

export type SystemConfig = ReturnType<typeof systemConfig>;
```

Register it in `src/config/config.module.ts`: add the import and append `systemConfig` to the `load: [...]` array.

```ts
import { systemConfig } from './configurations/system.config';
// ...
      load: [
        appConfig,
        authConfig,
        databaseConfig,
        redisConfig,
        sentryConfig,
        storageConfig,
        searchConfig,
        systemConfig,
      ],
```

- [ ] **Step 5: Implement EncryptionService + CryptoModule**

Create `src/infrastructure/crypto/encryption.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SystemConfig } from '../../config/configurations/system.config';

/**
 * Reversible secret encryption at rest (AES-256-GCM). The counterpart to the
 * one-way TokenService.hashToken: values encrypted here (SMTP/IMAP passwords,
 * integration tokens) must be decryptable to be used.
 *
 * Envelope (single self-describing string): `v{version}.{iv}.{tag}.{ciphertext}`
 * with each binary part base64-encoded. The version prefix leaves room for key
 * rotation without a schema change (v1 ships a single key).
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;
  private readonly version: number;

  constructor(config: ConfigService) {
    const cfg = config.getOrThrow<SystemConfig>('system');
    this.key = Buffer.from(cfg.encryptionKey, 'base64');
    if (this.key.length !== 32) {
      throw new Error(
        'SYSTEM_ENCRYPTION_KEY must decode to 32 bytes (AES-256).',
      );
    }
    this.version = cfg.encryptionKeyVersion;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      `v${this.version}`,
      iv.toString('base64'),
      tag.toString('base64'),
      ciphertext.toString('base64'),
    ].join('.');
  }

  decrypt(envelope: string): string {
    const parts = envelope.split('.');
    if (parts.length !== 4 || !parts[0].startsWith('v')) {
      throw new Error('Malformed encryption envelope.');
    }
    const [, ivB64, tagB64, ctB64] = parts;
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
```

Create `src/infrastructure/crypto/crypto.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';

/** Provides the reusable EncryptionService (reads the `system` config). */
@Module({
  providers: [EncryptionService],
  exports: [EncryptionService],
})
export class CryptoModule {}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test -- encryption.service`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add src/infrastructure/crypto src/config/configurations/system.config.ts src/config/config.module.ts src/config/env.validation.ts
git commit -m "feat(system): add AES-256-GCM EncryptionService and system config"
```

---

## Task 2: Database schema + migration

**Files:**
- Create: `src/infrastructure/database/schema/system.schema.ts`
- Modify: `src/infrastructure/database/schema/index.ts` (barrel export)
- Test: `src/infrastructure/database/schema/system.schema.spec.ts`
- Generated: `src/infrastructure/database/migrations/*` (via `pnpm db:generate`)

**Interfaces:**
- Produces (tables + inferred row types):
  - `smtpConfigs` → `SmtpConfigRow`, `NewSmtpConfigRow`
  - `imapConfigs` → `ImapConfigRow`, `NewImapConfigRow`
  - `integrationCredentials` → `IntegrationCredentialRow`, `NewIntegrationCredentialRow`
  - `systemSettings` → `SystemSettingRow`, `NewSystemSettingRow`
  - `systemAuditLog` → `SystemAuditRow`, `NewSystemAuditRow`
  - enums `credentialKind`, `settingType`
  - `type SettingValue = string | number | boolean | Record<string, unknown> | unknown[]`

- [ ] **Step 1: Write the failing test**

Create `src/infrastructure/database/schema/system.schema.spec.ts`:

```ts
import {
  credentialKind,
  imapConfigs,
  integrationCredentials,
  settingType,
  smtpConfigs,
  systemAuditLog,
  systemSettings,
} from './system.schema';

describe('system schema', () => {
  it('defines the credential_kind enum', () => {
    expect(credentialKind.enumValues).toEqual([
      'api_key',
      'oauth2',
      'basic',
      'bearer',
    ]);
  });

  it('defines the setting_type enum', () => {
    expect(settingType.enumValues).toEqual([
      'string',
      'number',
      'boolean',
      'json',
    ]);
  });

  it('exposes all system tables', () => {
    expect(smtpConfigs).toBeDefined();
    expect(imapConfigs).toBeDefined();
    expect(integrationCredentials).toBeDefined();
    expect(systemSettings).toBeDefined();
    expect(systemAuditLog).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- system.schema`
Expected: FAIL — `Cannot find module './system.schema'`.

- [ ] **Step 3: Create the schema**

Create `src/infrastructure/database/schema/system.schema.ts`:

```ts
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './common';
import { users } from './identity.schema';

/** How an integration credential authenticates to a 3rd-party service. */
export const credentialKind = pgEnum('credential_kind', [
  'api_key',
  'oauth2',
  'basic',
  'bearer',
]);

/** Value type of a generic system setting (drives typed reads + validation). */
export const settingType = pgEnum('setting_type', [
  'string',
  'number',
  'boolean',
  'json',
]);

/** A generic setting value, stored as JSON. */
export type SettingValue =
  | string
  | number
  | boolean
  | Record<string, unknown>
  | unknown[];

/**
 * SMTP sender profiles. The password is stored only as an encryption envelope
 * (`secretEnc`); nullable because some relays authenticate by IP. At most one
 * row may be active at a time (partial unique index).
 */
export const smtpConfigs = pgTable(
  'smtp_configs',
  {
    ...baseColumns,
    name: varchar('name', { length: 255 }).notNull(),
    host: varchar('host', { length: 255 }).notNull(),
    port: integer('port').notNull(),
    username: varchar('username', { length: 255 }),
    secretEnc: varchar('secret_enc', { length: 2048 }),
    secure: boolean('secure').notNull().default(true),
    fromAddress: varchar('from_address', { length: 255 }).notNull(),
    fromName: varchar('from_name', { length: 255 }),
    isActive: boolean('is_active').notNull().default(false),
    lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
    lastTestStatus: varchar('last_test_status', { length: 50 }),
  },
  (t) => [
    uniqueIndex('smtp_configs_single_active_idx')
      .on(t.isActive)
      .where(sql`${t.isActive} = true AND ${t.isDeleted} = false`),
  ],
);

/**
 * IMAP receiver profiles. Same secret + single-active discipline as SMTP,
 * minus the sender fields.
 */
export const imapConfigs = pgTable(
  'imap_configs',
  {
    ...baseColumns,
    name: varchar('name', { length: 255 }).notNull(),
    host: varchar('host', { length: 255 }).notNull(),
    port: integer('port').notNull(),
    username: varchar('username', { length: 255 }),
    secretEnc: varchar('secret_enc', { length: 2048 }),
    secure: boolean('secure').notNull().default(true),
    isActive: boolean('is_active').notNull().default(false),
    lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
    lastTestStatus: varchar('last_test_status', { length: 50 }),
  },
  (t) => [
    uniqueIndex('imap_configs_single_active_idx')
      .on(t.isActive)
      .where(sql`${t.isActive} = true AND ${t.isDeleted} = false`),
  ],
);

/**
 * Outbound 3rd-party credentials. `secretEnc` (required) is the encrypted
 * token/secret; `meta` holds NON-secret fields (baseUrl, scopes, clientId…).
 * Unique per (provider, name) among live rows; multiple accounts per provider
 * are allowed.
 */
export const integrationCredentials = pgTable(
  'integration_credentials',
  {
    ...baseColumns,
    provider: varchar('provider', { length: 100 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    kind: credentialKind('kind').notNull().default('api_key'),
    secretEnc: varchar('secret_enc', { length: 2048 }).notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
    lastTestStatus: varchar('last_test_status', { length: 50 }),
  },
  (t) => [
    uniqueIndex('integration_credentials_provider_name_idx')
      .on(t.provider, t.name)
      .where(sql`${t.isDeleted} = false`),
    index('integration_credentials_provider_idx').on(t.provider),
  ],
);

/**
 * Generic key/value app settings — non-secret by design (secrets belong in the
 * dedicated tables above). `valueJson` holds the typed value; `type` records
 * how to interpret it.
 */
export const systemSettings = pgTable(
  'system_settings',
  {
    ...baseColumns,
    key: varchar('key', { length: 150 }).notNull(),
    valueJson: jsonb('value_json').$type<SettingValue>().notNull(),
    type: settingType('type').notNull(),
    category: varchar('category', { length: 100 }).notNull().default('general'),
    description: varchar('description', { length: 500 }),
  },
  (t) => [
    uniqueIndex('system_settings_key_idx')
      .on(t.key)
      .where(sql`${t.isDeleted} = false`),
    index('system_settings_category_idx').on(t.category),
  ],
);

/**
 * Append-only audit trail of admin changes to system records. Not soft-deleted
 * (no baseColumns). `metadata` is redacted — changed field NAMES only, never
 * secret values.
 */
export const systemAuditLog = pgTable(
  'system_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    actorId: uuid('actor_id').references(() => users.id),
    action: varchar('action', { length: 100 }).notNull(),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: uuid('entity_id'),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ip: varchar('ip', { length: 45 }),
    userAgent: varchar('user_agent', { length: 512 }),
  },
  (t) => [
    index('system_audit_entity_idx').on(t.entityType, t.entityId),
    index('system_audit_actor_idx').on(t.actorId),
    index('system_audit_created_idx').on(t.createdAt),
  ],
);

export type SmtpConfigRow = typeof smtpConfigs.$inferSelect;
export type NewSmtpConfigRow = typeof smtpConfigs.$inferInsert;
export type ImapConfigRow = typeof imapConfigs.$inferSelect;
export type NewImapConfigRow = typeof imapConfigs.$inferInsert;
export type IntegrationCredentialRow = typeof integrationCredentials.$inferSelect;
export type NewIntegrationCredentialRow =
  typeof integrationCredentials.$inferInsert;
export type SystemSettingRow = typeof systemSettings.$inferSelect;
export type NewSystemSettingRow = typeof systemSettings.$inferInsert;
export type SystemAuditRow = typeof systemAuditLog.$inferSelect;
export type NewSystemAuditRow = typeof systemAuditLog.$inferInsert;
```

Add to `src/infrastructure/database/schema/index.ts`:

```ts
export * from './system.schema';
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run: `pnpm test -- system.schema && pnpm typecheck`
Expected: PASS (3 tests) and no type errors.

- [ ] **Step 5: Generate the migration**

Run: `pnpm db:generate`
Expected: a new file under `src/infrastructure/database/migrations/` creating the 2 enums + 5 tables + indexes. Review it — confirm the two `*_single_active_idx` are partial unique indexes with the `WHERE (is_active = true AND is_deleted = false)` predicate.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/database/schema src/infrastructure/database/migrations
git commit -m "feat(system): add system-records schema and migration"
```

---

## Task 3: Audit foundation + SystemModule skeleton

Build the audit trail first — every other service depends on it — plus the shared list-query DTO and the module wiring.

**Files:**
- Create: `src/features/system/dto/list-query.dto.ts`
- Create: `src/features/system/system-audit.types.ts`
- Create: `src/features/system/system-audit.repository.ts`
- Create: `src/features/system/system-audit.service.ts`
- Create: `src/features/system/system-audit.controller.ts`
- Create: `src/features/system/system.module.ts`
- Modify: `src/app.module.ts` (register `SystemModule` before `MastraModule`)
- Test: `src/features/system/system-audit.service.spec.ts`

**Interfaces:**
- Produces:
  - `type AuditEntityType = 'smtp' | 'imap' | 'integration' | 'setting'`
  - `interface AuditContext { actorId: string | null; ip?: string | null; userAgent?: string | null }`
  - `interface RecordAuditInput { ctx: AuditContext; action: string; entityType: AuditEntityType; entityId?: string | null; metadata?: Record<string, unknown> }`
  - `SystemAuditService.record(input: RecordAuditInput): Promise<void>` (never throws)
  - `SystemAuditService.list(q: { page: number; limit: number; entityType?: string; entityId?: string; actorId?: string }): Promise<{ data: SystemAuditRow[]; total: number; page: number; limit: number }>`
  - `listQuerySchema` / `ListQueryDto = { page: number; limit: number }`
  - `SystemModule` (exports `SystemAuditService` for sibling services)

- [ ] **Step 1: Write the failing test**

Create `src/features/system/system-audit.service.spec.ts`:

```ts
import { SystemAuditService } from './system-audit.service';

describe('SystemAuditService', () => {
  let repo: any;
  let service: SystemAuditService;

  beforeEach(() => {
    repo = {
      insert: jest.fn(async () => undefined),
      list: jest.fn(async () => ({ rows: [], total: 0 })),
    };
    service = new SystemAuditService(repo);
  });

  it('records an audit row with the actor + context', async () => {
    await service.record({
      ctx: { actorId: 'admin-1', ip: '1.2.3.4', userAgent: 'jest' },
      action: 'smtp.create',
      entityType: 'smtp',
      entityId: 'cfg-1',
      metadata: { fields: ['host', 'port'] },
    });
    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        action: 'smtp.create',
        entityType: 'smtp',
        entityId: 'cfg-1',
        ip: '1.2.3.4',
        userAgent: 'jest',
        metadata: { fields: ['host', 'port'] },
      }),
    );
  });

  it('never throws when the audit write fails', async () => {
    repo.insert.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.record({
        ctx: { actorId: null },
        action: 'setting.update',
        entityType: 'setting',
      }),
    ).resolves.toBeUndefined();
  });

  it('lists audit rows with pagination', async () => {
    repo.list.mockResolvedValueOnce({ rows: [{ id: 'a1' }], total: 1 });
    const res = await service.list({ page: 1, limit: 20 });
    expect(res).toEqual({ data: [{ id: 'a1' }], total: 1, page: 1, limit: 20 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- system-audit.service`
Expected: FAIL — `Cannot find module './system-audit.service'`.

- [ ] **Step 3: Create the shared DTO + audit types**

Create `src/features/system/dto/list-query.dto.ts`:

```ts
import { z } from 'zod';

/** Shared pagination for system list endpoints. */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type ListQueryDto = z.infer<typeof listQuerySchema>;

/** Audit list filters (extends pagination). */
export const auditQuerySchema = listQuerySchema.extend({
  entityType: z.enum(['smtp', 'imap', 'integration', 'setting']).optional(),
  entityId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
});

export type AuditQueryDto = z.infer<typeof auditQuerySchema>;
```

Create `src/features/system/system-audit.types.ts`:

```ts
/** The kinds of records the system module audits. */
export type AuditEntityType = 'smtp' | 'imap' | 'integration' | 'setting';

/** Who/where a mutation came from — sourced from the request principal. */
export interface AuditContext {
  actorId: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** A single audit event to record. `metadata` must never contain secrets. */
export interface RecordAuditInput {
  ctx: AuditContext;
  action: string;
  entityType: AuditEntityType;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}
```

- [ ] **Step 4: Create the audit repository**

Create `src/features/system/system-audit.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import {
  systemAuditLog,
  type NewSystemAuditRow,
  type SystemAuditRow,
} from '../../infrastructure/database/schema/system.schema';

export interface AuditListQuery {
  page: number;
  limit: number;
  entityType?: string;
  entityId?: string;
  actorId?: string;
}

/** Append + read only. The audit log is never updated or deleted. */
@Injectable()
export class SystemAuditRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async insert(row: NewSystemAuditRow): Promise<void> {
    await this.db.insert(systemAuditLog).values(row);
  }

  async list(
    q: AuditListQuery,
  ): Promise<{ rows: SystemAuditRow[]; total: number }> {
    const filters: SQL[] = [];
    if (q.entityType)
      filters.push(eq(systemAuditLog.entityType, q.entityType));
    if (q.entityId) filters.push(eq(systemAuditLog.entityId, q.entityId));
    if (q.actorId) filters.push(eq(systemAuditLog.actorId, q.actorId));
    const where = filters.length ? and(...filters) : undefined;

    const rows = await this.db
      .select()
      .from(systemAuditLog)
      .where(where)
      .orderBy(desc(systemAuditLog.createdAt))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    const totals = await this.db
      .select({ value: count() })
      .from(systemAuditLog)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }
}
```

- [ ] **Step 5: Create the audit service**

Create `src/features/system/system-audit.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import type { SystemAuditRow } from '../../infrastructure/database/schema/system.schema';
import {
  SystemAuditRepository,
  type AuditListQuery,
} from './system-audit.repository';
import type { RecordAuditInput } from './system-audit.types';

@Injectable()
export class SystemAuditService {
  private readonly logger = new Logger(SystemAuditService.name);

  constructor(private readonly repo: SystemAuditRepository) {}

  /** Best-effort: audit failures are logged, never bubbled to the caller. */
  async record(input: RecordAuditInput): Promise<void> {
    try {
      await this.repo.insert({
        actorId: input.ctx.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadata: input.metadata ?? {},
        ip: input.ctx.ip ?? null,
        userAgent: input.ctx.userAgent ?? null,
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit row for ${input.action}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  async list(q: AuditListQuery): Promise<{
    data: SystemAuditRow[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { rows, total } = await this.repo.list(q);
    return { data: rows, total, page: q.page, limit: q.limit };
  }
}
```

- [ ] **Step 6: Create the audit controller**

Create `src/features/system/system-audit.controller.ts`:

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { auditQuerySchema, type AuditQueryDto } from './dto/list-query.dto';
import { SystemAuditService } from './system-audit.service';

/** Read-only audit trail for system-records changes. Admin only. */
@Roles('admin')
@Controller('system/audit')
export class SystemAuditController {
  constructor(private readonly audit: SystemAuditService) {}

  @Get()
  list(@Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQueryDto) {
    return this.audit.list(query);
  }
}
```

- [ ] **Step 7: Create SystemModule + register in AppModule**

Create `src/features/system/system.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CryptoModule } from '../../infrastructure/crypto/crypto.module';
import { SystemAuditController } from './system-audit.controller';
import { SystemAuditRepository } from './system-audit.repository';
import { SystemAuditService } from './system-audit.service';

/**
 * System-records feature. Admin-only (enforced by the global RolesGuard via
 * @Roles('admin') on each controller). DatabaseModule + CacheModule are global,
 * so only CryptoModule needs importing.
 */
@Module({
  imports: [CryptoModule],
  controllers: [SystemAuditController],
  providers: [SystemAuditRepository, SystemAuditService],
  exports: [SystemAuditService],
})
export class SystemModule {}
```

In `src/app.module.ts`, add the import and register it in the feature-module list **before `MastraModule`**:

```ts
import { SystemModule } from './features/system/system.module';
// ...
    // Feature modules.
    AuthModule,
    UsersModule,
    FileProcessorModule,
    SearchServiceModule,
    SystemModule,

    // Mastra AI — must remain last.
    MastraModule,
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm test -- system-audit.service && pnpm typecheck`
Expected: PASS (3 tests) and no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/features/system src/app.module.ts
git commit -m "feat(system): add audit log foundation and SystemModule"
```

---

## Task 4: SMTP configs

**Files:**
- Create: `src/features/system/dto/create-smtp.dto.ts`
- Create: `src/features/system/dto/update-smtp.dto.ts`
- Create: `src/features/system/connection/smtp-tester.ts`
- Create: `src/features/system/smtp-config.repository.ts`
- Create: `src/features/system/smtp-config.service.ts`
- Create: `src/features/system/smtp-config.controller.ts`
- Modify: `src/features/system/system.module.ts` (register providers + controller)
- Modify: `package.json` (add `nodemailer`, `@types/nodemailer`)
- Test: `src/features/system/smtp-config.service.spec.ts`

**Interfaces:**
- Consumes: `EncryptionService`, `SystemAuditService`, `AuditContext` (Task 1/3).
- Produces:
  - `interface PublicSmtpConfig { id; name; host; port; username: string | null; secure; fromAddress; fromName: string | null; isActive; hasSecret: boolean; lastTestedAt: Date | null; lastTestStatus: string | null; createdAt: Date; updatedAt: Date }`
  - `SmtpConfigService.create(dto, ctx): Promise<PublicSmtpConfig>`
  - `.findById(id): Promise<PublicSmtpConfig>`
  - `.list(page, limit): Promise<{ data; total; page; limit }>`
  - `.update(id, dto, ctx): Promise<PublicSmtpConfig>`
  - `.remove(id, ctx): Promise<void>`
  - `.activate(id, ctx): Promise<PublicSmtpConfig>`
  - `.test(id, ctx): Promise<{ ok: boolean; error?: string }>`
  - `testSmtpConnection(params): Promise<void>` (throws on failure)

- [ ] **Step 1: Add the nodemailer dependency**

Run: `pnpm add nodemailer && pnpm add -D @types/nodemailer`
Expected: both added to `package.json`. (No native build; `pnpm.onlyBuiltDependencies` is unaffected.)

- [ ] **Step 2: Write the failing test**

Create `src/features/system/smtp-config.service.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { SmtpConfigService } from './smtp-config.service';

jest.mock('./connection/smtp-tester', () => ({
  testSmtpConnection: jest.fn(async () => undefined),
}));
import { testSmtpConnection } from './connection/smtp-tester';

function makeRow(overrides: Record<string, any> = {}) {
  return {
    id: 's1',
    name: 'Primary',
    host: 'smtp.example.com',
    port: 587,
    username: 'mailer',
    secretEnc: 'v1.iv.tag.ct',
    secure: true,
    fromAddress: 'no-reply@example.com',
    fromName: null,
    isActive: false,
    lastTestedAt: null,
    lastTestStatus: null,
    createdAt: new Date('2020-01-01'),
    updatedAt: new Date('2020-01-01'),
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  };
}

const ctx = { actorId: 'admin-1', ip: '1.2.3.4', userAgent: 'jest' };

describe('SmtpConfigService', () => {
  let repo: any;
  let crypto: any;
  let audit: any;
  let service: SmtpConfigService;

  beforeEach(() => {
    (testSmtpConnection as jest.Mock).mockClear();
    repo = {
      create: jest.fn(async (v: any) => makeRow(v)),
      findActiveById: jest.fn(async () => makeRow()),
      list: jest.fn(async () => ({ rows: [makeRow()], total: 1 })),
      update: jest.fn(async (id: string, patch: any) => makeRow({ id, ...patch })),
      softDelete: jest.fn(async () => undefined),
      activate: jest.fn(async (id: string) => makeRow({ id, isActive: true })),
      stampTest: jest.fn(async () => undefined),
    };
    crypto = {
      encrypt: jest.fn(() => 'v1.enc'),
      decrypt: jest.fn(() => 'plaintext-pass'),
    };
    audit = { record: jest.fn(async () => undefined) };
    service = new SmtpConfigService(repo, crypto, audit);
  });

  it('encrypts the secret on create and never returns it', async () => {
    const res = await service.create(
      {
        name: 'Primary',
        host: 'smtp.example.com',
        port: 587,
        username: 'mailer',
        secret: 'raw-pass',
        secure: true,
        fromAddress: 'no-reply@example.com',
      } as any,
      ctx,
    );
    expect(crypto.encrypt).toHaveBeenCalledWith('raw-pass');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ secretEnc: 'v1.enc' }),
    );
    expect((res as any).secretEnc).toBeUndefined();
    expect((res as any).secret).toBeUndefined();
    expect(res.hasSecret).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'smtp.create', entityType: 'smtp' }),
    );
  });

  it('re-encrypts only when a new secret is supplied on update', async () => {
    await service.update('s1', { host: 'new.example.com' } as any, ctx);
    expect(crypto.encrypt).not.toHaveBeenCalled();
    await service.update('s1', { secret: 'new-pass' } as any, ctx);
    expect(crypto.encrypt).toHaveBeenCalledWith('new-pass');
  });

  it('404s on a missing config', async () => {
    repo.findActiveById.mockResolvedValueOnce(null);
    await expect(service.findById('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('activates via the repo transaction and audits', async () => {
    const res = await service.activate('s1', ctx);
    expect(repo.activate).toHaveBeenCalledWith('s1');
    expect(res.isActive).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'smtp.activate' }),
    );
  });

  it('tests the connection, stamps status, and reports ok', async () => {
    const res = await service.test('s1', ctx);
    expect(testSmtpConnection).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.example.com', password: 'plaintext-pass' }),
    );
    expect(repo.stampTest).toHaveBeenCalledWith('s1', 'ok');
    expect(res).toEqual({ ok: true });
  });

  it('reports a failed connection test without throwing', async () => {
    (testSmtpConnection as jest.Mock).mockRejectedValueOnce(new Error('EAUTH'));
    const res = await service.test('s1', ctx);
    expect(repo.stampTest).toHaveBeenCalledWith('s1', 'failed');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('EAUTH');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- smtp-config.service`
Expected: FAIL — `Cannot find module './smtp-config.service'`.

- [ ] **Step 4: Create the DTOs**

Create `src/features/system/dto/create-smtp.dto.ts`:

```ts
import { z } from 'zod';

export const createSmtpSchema = z.object({
  name: z.string().min(1).max(255),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().max(255).optional(),
  secret: z.string().min(1).max(1024).optional(),
  secure: z.boolean().default(true),
  fromAddress: z.string().email().max(255),
  fromName: z.string().max(255).optional(),
});

export type CreateSmtpDto = z.infer<typeof createSmtpSchema>;
```

Create `src/features/system/dto/update-smtp.dto.ts`:

```ts
import { createSmtpSchema } from './create-smtp.dto';
import { z } from 'zod';

export const updateSmtpSchema = createSmtpSchema.partial();

export type UpdateSmtpDto = z.infer<typeof updateSmtpSchema>;
```

- [ ] **Step 5: Create the SMTP connection tester**

Create `src/features/system/connection/smtp-tester.ts`:

```ts
import { createTransport } from 'nodemailer';

export interface SmtpTestParams {
  host: string;
  port: number;
  secure: boolean;
  username?: string | null;
  password?: string | null;
}

/**
 * Opens a connection and runs SMTP verify (EHLO + AUTH when credentials are
 * present). Throws on any connectivity/auth failure. No mail is sent.
 */
export async function testSmtpConnection(p: SmtpTestParams): Promise<void> {
  const transport = createTransport({
    host: p.host,
    port: p.port,
    secure: p.secure,
    auth: p.username ? { user: p.username, pass: p.password ?? '' } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}
```

- [ ] **Step 6: Create the repository**

Create `src/features/system/smtp-config.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import {
  smtpConfigs,
  type NewSmtpConfigRow,
  type SmtpConfigRow,
} from '../../infrastructure/database/schema/system.schema';

@Injectable()
export class SmtpConfigRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(values: NewSmtpConfigRow): Promise<SmtpConfigRow> {
    const rows = await this.db.insert(smtpConfigs).values(values).returning();
    return rows[0];
  }

  async findActiveById(id: string): Promise<SmtpConfigRow | null> {
    const rows = await this.db
      .select()
      .from(smtpConfigs)
      .where(and(eq(smtpConfigs.id, id), eq(smtpConfigs.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findActive(): Promise<SmtpConfigRow | null> {
    const rows = await this.db
      .select()
      .from(smtpConfigs)
      .where(and(eq(smtpConfigs.isActive, true), eq(smtpConfigs.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(
    page: number,
    limit: number,
  ): Promise<{ rows: SmtpConfigRow[]; total: number }> {
    const where = eq(smtpConfigs.isDeleted, false);
    const rows = await this.db
      .select()
      .from(smtpConfigs)
      .where(where)
      .orderBy(desc(smtpConfigs.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    const totals = await this.db
      .select({ value: count() })
      .from(smtpConfigs)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  async update(
    id: string,
    patch: Partial<NewSmtpConfigRow>,
  ): Promise<SmtpConfigRow | null> {
    const rows = await this.db
      .update(smtpConfigs)
      .set(patch)
      .where(and(eq(smtpConfigs.id, id), eq(smtpConfigs.isDeleted, false)))
      .returning();
    return rows[0] ?? null;
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(smtpConfigs)
      .set({ isDeleted: true, deletedAt: new Date(), isActive: false })
      .where(eq(smtpConfigs.id, id));
  }

  /** Transactionally enforce single-active: deactivate all, then activate id. */
  async activate(id: string): Promise<SmtpConfigRow | null> {
    return this.db.transaction(async (tx) => {
      await tx
        .update(smtpConfigs)
        .set({ isActive: false })
        .where(
          and(eq(smtpConfigs.isActive, true), eq(smtpConfigs.isDeleted, false)),
        );
      const rows = await tx
        .update(smtpConfigs)
        .set({ isActive: true })
        .where(and(eq(smtpConfigs.id, id), eq(smtpConfigs.isDeleted, false)))
        .returning();
      return rows[0] ?? null;
    });
  }

  async stampTest(id: string, status: 'ok' | 'failed'): Promise<void> {
    await this.db
      .update(smtpConfigs)
      .set({ lastTestedAt: new Date(), lastTestStatus: status })
      .where(eq(smtpConfigs.id, id));
  }
}
```

- [ ] **Step 7: Create the service**

Create `src/features/system/smtp-config.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service';
import type { SmtpConfigRow } from '../../infrastructure/database/schema/system.schema';
import { testSmtpConnection } from './connection/smtp-tester';
import type { CreateSmtpDto } from './dto/create-smtp.dto';
import type { UpdateSmtpDto } from './dto/update-smtp.dto';
import { SmtpConfigRepository } from './smtp-config.repository';
import { SystemAuditService } from './system-audit.service';
import type { AuditContext } from './system-audit.types';

export interface PublicSmtpConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string | null;
  secure: boolean;
  fromAddress: string;
  fromName: string | null;
  isActive: boolean;
  hasSecret: boolean;
  lastTestedAt: Date | null;
  lastTestStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class SmtpConfigService {
  constructor(
    private readonly repo: SmtpConfigRepository,
    private readonly crypto: EncryptionService,
    private readonly audit: SystemAuditService,
  ) {}

  private toPublic(row: SmtpConfigRow): PublicSmtpConfig {
    return {
      id: row.id,
      name: row.name,
      host: row.host,
      port: row.port,
      username: row.username ?? null,
      secure: row.secure,
      fromAddress: row.fromAddress,
      fromName: row.fromName ?? null,
      isActive: row.isActive,
      hasSecret: Boolean(row.secretEnc),
      lastTestedAt: row.lastTestedAt ?? null,
      lastTestStatus: row.lastTestStatus ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async getRow(id: string): Promise<SmtpConfigRow> {
    const row = await this.repo.findActiveById(id);
    if (!row) throw new NotFoundException('SMTP config not found');
    return row;
  }

  async create(dto: CreateSmtpDto, ctx: AuditContext): Promise<PublicSmtpConfig> {
    const row = await this.repo.create({
      name: dto.name,
      host: dto.host,
      port: dto.port,
      username: dto.username,
      secretEnc: dto.secret ? this.crypto.encrypt(dto.secret) : null,
      secure: dto.secure,
      fromAddress: dto.fromAddress,
      fromName: dto.fromName,
    });
    await this.audit.record({
      ctx,
      action: 'smtp.create',
      entityType: 'smtp',
      entityId: row.id,
      metadata: { name: row.name, host: row.host },
    });
    return this.toPublic(row);
  }

  async findById(id: string): Promise<PublicSmtpConfig> {
    return this.toPublic(await this.getRow(id));
  }

  async list(page: number, limit: number) {
    const { rows, total } = await this.repo.list(page, limit);
    return { data: rows.map((r) => this.toPublic(r)), total, page, limit };
  }

  async update(
    id: string,
    dto: UpdateSmtpDto,
    ctx: AuditContext,
  ): Promise<PublicSmtpConfig> {
    await this.getRow(id); // 404 if missing
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.host !== undefined) patch.host = dto.host;
    if (dto.port !== undefined) patch.port = dto.port;
    if (dto.username !== undefined) patch.username = dto.username;
    if (dto.secure !== undefined) patch.secure = dto.secure;
    if (dto.fromAddress !== undefined) patch.fromAddress = dto.fromAddress;
    if (dto.fromName !== undefined) patch.fromName = dto.fromName;
    if (dto.secret !== undefined) patch.secretEnc = this.crypto.encrypt(dto.secret);

    const row = await this.repo.update(id, patch);
    if (!row) throw new NotFoundException('SMTP config not found');
    await this.audit.record({
      ctx,
      action: 'smtp.update',
      entityType: 'smtp',
      entityId: id,
      metadata: { fields: Object.keys(patch).filter((k) => k !== 'secretEnc') },
    });
    return this.toPublic(row);
  }

  async remove(id: string, ctx: AuditContext): Promise<void> {
    await this.getRow(id);
    await this.repo.softDelete(id);
    await this.audit.record({
      ctx,
      action: 'smtp.delete',
      entityType: 'smtp',
      entityId: id,
    });
  }

  async activate(id: string, ctx: AuditContext): Promise<PublicSmtpConfig> {
    await this.getRow(id);
    const row = await this.repo.activate(id);
    if (!row) throw new NotFoundException('SMTP config not found');
    await this.audit.record({
      ctx,
      action: 'smtp.activate',
      entityType: 'smtp',
      entityId: id,
    });
    return this.toPublic(row);
  }

  async test(
    id: string,
    ctx: AuditContext,
  ): Promise<{ ok: boolean; error?: string }> {
    const row = await this.getRow(id);
    try {
      await testSmtpConnection({
        host: row.host,
        port: row.port,
        secure: row.secure,
        username: row.username,
        password: row.secretEnc ? this.crypto.decrypt(row.secretEnc) : null,
      });
      await this.repo.stampTest(id, 'ok');
      await this.audit.record({
        ctx,
        action: 'smtp.test',
        entityType: 'smtp',
        entityId: id,
        metadata: { result: 'ok' },
      });
      return { ok: true };
    } catch (err) {
      await this.repo.stampTest(id, 'failed');
      const error = err instanceof Error ? err.message : String(err);
      await this.audit.record({
        ctx,
        action: 'smtp.test',
        entityType: 'smtp',
        entityId: id,
        metadata: { result: 'failed' },
      });
      return { ok: false, error };
    }
  }
}
```

- [ ] **Step 8: Create the controller**

Create `src/features/system/smtp-config.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { Principal } from '../../common/principal';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { createSmtpSchema, type CreateSmtpDto } from './dto/create-smtp.dto';
import { listQuerySchema, type ListQueryDto } from './dto/list-query.dto';
import { updateSmtpSchema, type UpdateSmtpDto } from './dto/update-smtp.dto';
import { SmtpConfigService } from './smtp-config.service';
import type { AuditContext } from './system-audit.types';

@Roles('admin')
@Controller('system/smtp')
export class SmtpConfigController {
  constructor(private readonly smtp: SmtpConfigService) {}

  private ctx(user: Principal, ip: string, ua?: string): AuditContext {
    return { actorId: user.id, ip, userAgent: ua ?? null };
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createSmtpSchema)) dto: CreateSmtpDto,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.smtp.create(dto, this.ctx(user, ip, ua));
  }

  @Get()
  list(@Query(new ZodValidationPipe(listQuerySchema)) query: ListQueryDto) {
    return this.smtp.list(query.page, query.limit);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.smtp.findById(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSmtpSchema)) dto: UpdateSmtpDto,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.smtp.update(id, dto, this.ctx(user, ip, ua));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ): Promise<void> {
    await this.smtp.remove(id, this.ctx(user, ip, ua));
  }

  @Post(':id/activate')
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.smtp.activate(id, this.ctx(user, ip, ua));
  }

  @Post(':id/test')
  test(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.smtp.test(id, this.ctx(user, ip, ua));
  }
}
```

- [ ] **Step 9: Register providers + controller in SystemModule**

Edit `src/features/system/system.module.ts` — add imports and extend the arrays:

```ts
import { SmtpConfigController } from './smtp-config.controller';
import { SmtpConfigRepository } from './smtp-config.repository';
import { SmtpConfigService } from './smtp-config.service';
```

```ts
  controllers: [SystemAuditController, SmtpConfigController],
  providers: [
    SystemAuditRepository,
    SystemAuditService,
    SmtpConfigRepository,
    SmtpConfigService,
  ],
  exports: [SystemAuditService],
```

- [ ] **Step 10: Run tests + typecheck to verify they pass**

Run: `pnpm test -- smtp-config.service && pnpm typecheck`
Expected: PASS (6 tests) and no type errors.

- [ ] **Step 11: Commit**

```bash
git add src/features/system package.json pnpm-lock.yaml
git commit -m "feat(system): add SMTP config CRUD, activate, and connection test"
```

---

## Task 5: IMAP configs

Mirrors SMTP without the sender fields; the tester is a dependency-free `node:tls` LOGIN smoke test.

**Files:**
- Create: `src/features/system/dto/create-imap.dto.ts`
- Create: `src/features/system/dto/update-imap.dto.ts`
- Create: `src/features/system/connection/imap-tester.ts`
- Create: `src/features/system/imap-config.repository.ts`
- Create: `src/features/system/imap-config.service.ts`
- Create: `src/features/system/imap-config.controller.ts`
- Modify: `src/features/system/system.module.ts`
- Test: `src/features/system/imap-config.service.spec.ts`

**Interfaces:**
- Consumes: `EncryptionService`, `SystemAuditService`, `AuditContext`.
- Produces:
  - `interface PublicImapConfig { id; name; host; port; username: string | null; secure; isActive; hasSecret: boolean; lastTestedAt: Date | null; lastTestStatus: string | null; createdAt: Date; updatedAt: Date }`
  - `ImapConfigService.{create,findById,list,update,remove,activate,test}` (same shapes as SMTP, returning `PublicImapConfig`).
  - `testImapConnection(params): Promise<void>` (throws on failure).

- [ ] **Step 1: Write the failing test**

Create `src/features/system/imap-config.service.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { ImapConfigService } from './imap-config.service';

jest.mock('./connection/imap-tester', () => ({
  testImapConnection: jest.fn(async () => undefined),
}));
import { testImapConnection } from './connection/imap-tester';

function makeRow(overrides: Record<string, any> = {}) {
  return {
    id: 'i1',
    name: 'Inbox',
    host: 'imap.example.com',
    port: 993,
    username: 'reader',
    secretEnc: 'v1.iv.tag.ct',
    secure: true,
    isActive: false,
    lastTestedAt: null,
    lastTestStatus: null,
    createdAt: new Date('2020-01-01'),
    updatedAt: new Date('2020-01-01'),
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  };
}

const ctx = { actorId: 'admin-1', ip: '1.2.3.4', userAgent: 'jest' };

describe('ImapConfigService', () => {
  let repo: any;
  let crypto: any;
  let audit: any;
  let service: ImapConfigService;

  beforeEach(() => {
    (testImapConnection as jest.Mock).mockClear();
    repo = {
      create: jest.fn(async (v: any) => makeRow(v)),
      findActiveById: jest.fn(async () => makeRow()),
      list: jest.fn(async () => ({ rows: [makeRow()], total: 1 })),
      update: jest.fn(async (id: string, patch: any) => makeRow({ id, ...patch })),
      softDelete: jest.fn(async () => undefined),
      activate: jest.fn(async (id: string) => makeRow({ id, isActive: true })),
      stampTest: jest.fn(async () => undefined),
    };
    crypto = { encrypt: jest.fn(() => 'v1.enc'), decrypt: jest.fn(() => 'pw') };
    audit = { record: jest.fn(async () => undefined) };
    service = new ImapConfigService(repo, crypto, audit);
  });

  it('encrypts the secret on create and redacts it', async () => {
    const res = await service.create(
      { name: 'Inbox', host: 'imap.example.com', port: 993, username: 'reader', secret: 'raw', secure: true } as any,
      ctx,
    );
    expect(crypto.encrypt).toHaveBeenCalledWith('raw');
    expect((res as any).secretEnc).toBeUndefined();
    expect(res.hasSecret).toBe(true);
  });

  it('404s on a missing config', async () => {
    repo.findActiveById.mockResolvedValueOnce(null);
    await expect(service.findById('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('activates via the repo transaction', async () => {
    const res = await service.activate('i1', ctx);
    expect(repo.activate).toHaveBeenCalledWith('i1');
    expect(res.isActive).toBe(true);
  });

  it('reports a failed connection test without throwing', async () => {
    (testImapConnection as jest.Mock).mockRejectedValueOnce(new Error('login rejected'));
    const res = await service.test('i1', ctx);
    expect(repo.stampTest).toHaveBeenCalledWith('i1', 'failed');
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- imap-config.service`
Expected: FAIL — `Cannot find module './imap-config.service'`.

- [ ] **Step 3: Create the DTOs**

Create `src/features/system/dto/create-imap.dto.ts`:

```ts
import { z } from 'zod';

export const createImapSchema = z.object({
  name: z.string().min(1).max(255),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().max(255).optional(),
  secret: z.string().min(1).max(1024).optional(),
  secure: z.boolean().default(true),
});

export type CreateImapDto = z.infer<typeof createImapSchema>;
```

Create `src/features/system/dto/update-imap.dto.ts`:

```ts
import { z } from 'zod';
import { createImapSchema } from './create-imap.dto';

export const updateImapSchema = createImapSchema.partial();

export type UpdateImapDto = z.infer<typeof updateImapSchema>;
```

- [ ] **Step 4: Create the IMAP connection tester**

Create `src/features/system/connection/imap-tester.ts`:

```ts
import * as net from 'node:net';
import { connect as tlsConnect } from 'node:tls';

export interface ImapTestParams {
  host: string;
  port: number;
  secure: boolean;
  username?: string | null;
  password?: string | null;
}

/**
 * Minimal, dependency-free IMAP connectivity + auth check: connect (TLS when
 * `secure`), wait for the `* OK` greeting, issue a tagged LOGIN, and inspect the
 * tagged response. Resolves on `a1 OK`, rejects otherwise. Deliberately small —
 * swappable for a full IMAP client later.
 */
export async function testImapConnection(p: ImapTestParams): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = p.secure
      ? tlsConnect({ host: p.host, port: p.port, servername: p.host })
      : net.connect({ host: p.host, port: p.port });

    const TAG = 'a1';
    let buffer = '';
    let sentLogin = false;
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.write(`${TAG} LOGOUT\r\n`);
      } catch {
        // ignore
      }
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };

    const timer = setTimeout(
      () => finish(new Error('IMAP connection timed out')),
      10_000,
    );

    socket.setEncoding('utf8');
    socket.on('error', (err) => finish(err));
    socket.on('close', () => {
      if (!settled) finish(new Error('IMAP connection closed unexpectedly'));
    });
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (!sentLogin && buffer.includes('* OK')) {
        sentLogin = true;
        buffer = '';
        const user = (p.username ?? '').replace(/["\\]/g, '\\$&');
        const pass = (p.password ?? '').replace(/["\\]/g, '\\$&');
        socket.write(`${TAG} LOGIN "${user}" "${pass}"\r\n`);
        return;
      }
      if (sentLogin && buffer.includes(`${TAG} `)) {
        const ok = new RegExp(`${TAG} OK`, 'i').test(buffer);
        finish(ok ? undefined : new Error('IMAP login rejected'));
      }
    });
  });
}
```

- [ ] **Step 5: Create the repository**

Create `src/features/system/imap-config.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import {
  imapConfigs,
  type ImapConfigRow,
  type NewImapConfigRow,
} from '../../infrastructure/database/schema/system.schema';

@Injectable()
export class ImapConfigRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(values: NewImapConfigRow): Promise<ImapConfigRow> {
    const rows = await this.db.insert(imapConfigs).values(values).returning();
    return rows[0];
  }

  async findActiveById(id: string): Promise<ImapConfigRow | null> {
    const rows = await this.db
      .select()
      .from(imapConfigs)
      .where(and(eq(imapConfigs.id, id), eq(imapConfigs.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findActive(): Promise<ImapConfigRow | null> {
    const rows = await this.db
      .select()
      .from(imapConfigs)
      .where(and(eq(imapConfigs.isActive, true), eq(imapConfigs.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(
    page: number,
    limit: number,
  ): Promise<{ rows: ImapConfigRow[]; total: number }> {
    const where = eq(imapConfigs.isDeleted, false);
    const rows = await this.db
      .select()
      .from(imapConfigs)
      .where(where)
      .orderBy(desc(imapConfigs.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    const totals = await this.db
      .select({ value: count() })
      .from(imapConfigs)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  async update(
    id: string,
    patch: Partial<NewImapConfigRow>,
  ): Promise<ImapConfigRow | null> {
    const rows = await this.db
      .update(imapConfigs)
      .set(patch)
      .where(and(eq(imapConfigs.id, id), eq(imapConfigs.isDeleted, false)))
      .returning();
    return rows[0] ?? null;
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(imapConfigs)
      .set({ isDeleted: true, deletedAt: new Date(), isActive: false })
      .where(eq(imapConfigs.id, id));
  }

  async activate(id: string): Promise<ImapConfigRow | null> {
    return this.db.transaction(async (tx) => {
      await tx
        .update(imapConfigs)
        .set({ isActive: false })
        .where(
          and(eq(imapConfigs.isActive, true), eq(imapConfigs.isDeleted, false)),
        );
      const rows = await tx
        .update(imapConfigs)
        .set({ isActive: true })
        .where(and(eq(imapConfigs.id, id), eq(imapConfigs.isDeleted, false)))
        .returning();
      return rows[0] ?? null;
    });
  }

  async stampTest(id: string, status: 'ok' | 'failed'): Promise<void> {
    await this.db
      .update(imapConfigs)
      .set({ lastTestedAt: new Date(), lastTestStatus: status })
      .where(eq(imapConfigs.id, id));
  }
}
```

- [ ] **Step 6: Create the service**

Create `src/features/system/imap-config.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service';
import type { ImapConfigRow } from '../../infrastructure/database/schema/system.schema';
import { testImapConnection } from './connection/imap-tester';
import type { CreateImapDto } from './dto/create-imap.dto';
import type { UpdateImapDto } from './dto/update-imap.dto';
import { ImapConfigRepository } from './imap-config.repository';
import { SystemAuditService } from './system-audit.service';
import type { AuditContext } from './system-audit.types';

export interface PublicImapConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string | null;
  secure: boolean;
  isActive: boolean;
  hasSecret: boolean;
  lastTestedAt: Date | null;
  lastTestStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ImapConfigService {
  constructor(
    private readonly repo: ImapConfigRepository,
    private readonly crypto: EncryptionService,
    private readonly audit: SystemAuditService,
  ) {}

  private toPublic(row: ImapConfigRow): PublicImapConfig {
    return {
      id: row.id,
      name: row.name,
      host: row.host,
      port: row.port,
      username: row.username ?? null,
      secure: row.secure,
      isActive: row.isActive,
      hasSecret: Boolean(row.secretEnc),
      lastTestedAt: row.lastTestedAt ?? null,
      lastTestStatus: row.lastTestStatus ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async getRow(id: string): Promise<ImapConfigRow> {
    const row = await this.repo.findActiveById(id);
    if (!row) throw new NotFoundException('IMAP config not found');
    return row;
  }

  async create(dto: CreateImapDto, ctx: AuditContext): Promise<PublicImapConfig> {
    const row = await this.repo.create({
      name: dto.name,
      host: dto.host,
      port: dto.port,
      username: dto.username,
      secretEnc: dto.secret ? this.crypto.encrypt(dto.secret) : null,
      secure: dto.secure,
    });
    await this.audit.record({
      ctx,
      action: 'imap.create',
      entityType: 'imap',
      entityId: row.id,
      metadata: { name: row.name, host: row.host },
    });
    return this.toPublic(row);
  }

  async findById(id: string): Promise<PublicImapConfig> {
    return this.toPublic(await this.getRow(id));
  }

  async list(page: number, limit: number) {
    const { rows, total } = await this.repo.list(page, limit);
    return { data: rows.map((r) => this.toPublic(r)), total, page, limit };
  }

  async update(
    id: string,
    dto: UpdateImapDto,
    ctx: AuditContext,
  ): Promise<PublicImapConfig> {
    await this.getRow(id);
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.host !== undefined) patch.host = dto.host;
    if (dto.port !== undefined) patch.port = dto.port;
    if (dto.username !== undefined) patch.username = dto.username;
    if (dto.secure !== undefined) patch.secure = dto.secure;
    if (dto.secret !== undefined) patch.secretEnc = this.crypto.encrypt(dto.secret);

    const row = await this.repo.update(id, patch);
    if (!row) throw new NotFoundException('IMAP config not found');
    await this.audit.record({
      ctx,
      action: 'imap.update',
      entityType: 'imap',
      entityId: id,
      metadata: { fields: Object.keys(patch).filter((k) => k !== 'secretEnc') },
    });
    return this.toPublic(row);
  }

  async remove(id: string, ctx: AuditContext): Promise<void> {
    await this.getRow(id);
    await this.repo.softDelete(id);
    await this.audit.record({
      ctx,
      action: 'imap.delete',
      entityType: 'imap',
      entityId: id,
    });
  }

  async activate(id: string, ctx: AuditContext): Promise<PublicImapConfig> {
    await this.getRow(id);
    const row = await this.repo.activate(id);
    if (!row) throw new NotFoundException('IMAP config not found');
    await this.audit.record({
      ctx,
      action: 'imap.activate',
      entityType: 'imap',
      entityId: id,
    });
    return this.toPublic(row);
  }

  async test(
    id: string,
    ctx: AuditContext,
  ): Promise<{ ok: boolean; error?: string }> {
    const row = await this.getRow(id);
    try {
      await testImapConnection({
        host: row.host,
        port: row.port,
        secure: row.secure,
        username: row.username,
        password: row.secretEnc ? this.crypto.decrypt(row.secretEnc) : null,
      });
      await this.repo.stampTest(id, 'ok');
      await this.audit.record({
        ctx,
        action: 'imap.test',
        entityType: 'imap',
        entityId: id,
        metadata: { result: 'ok' },
      });
      return { ok: true };
    } catch (err) {
      await this.repo.stampTest(id, 'failed');
      await this.audit.record({
        ctx,
        action: 'imap.test',
        entityType: 'imap',
        entityId: id,
        metadata: { result: 'failed' },
      });
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
```

- [ ] **Step 7: Create the controller**

Create `src/features/system/imap-config.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { Principal } from '../../common/principal';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { createImapSchema, type CreateImapDto } from './dto/create-imap.dto';
import { listQuerySchema, type ListQueryDto } from './dto/list-query.dto';
import { updateImapSchema, type UpdateImapDto } from './dto/update-imap.dto';
import { ImapConfigService } from './imap-config.service';
import type { AuditContext } from './system-audit.types';

@Roles('admin')
@Controller('system/imap')
export class ImapConfigController {
  constructor(private readonly imap: ImapConfigService) {}

  private ctx(user: Principal, ip: string, ua?: string): AuditContext {
    return { actorId: user.id, ip, userAgent: ua ?? null };
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createImapSchema)) dto: CreateImapDto,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.imap.create(dto, this.ctx(user, ip, ua));
  }

  @Get()
  list(@Query(new ZodValidationPipe(listQuerySchema)) query: ListQueryDto) {
    return this.imap.list(query.page, query.limit);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.imap.findById(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateImapSchema)) dto: UpdateImapDto,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.imap.update(id, dto, this.ctx(user, ip, ua));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ): Promise<void> {
    await this.imap.remove(id, this.ctx(user, ip, ua));
  }

  @Post(':id/activate')
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.imap.activate(id, this.ctx(user, ip, ua));
  }

  @Post(':id/test')
  test(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.imap.test(id, this.ctx(user, ip, ua));
  }
}
```

- [ ] **Step 8: Register in SystemModule**

Edit `src/features/system/system.module.ts` — add imports for `ImapConfigController`, `ImapConfigRepository`, `ImapConfigService`, then add them to `controllers` and `providers`.

- [ ] **Step 9: Run tests + typecheck**

Run: `pnpm test -- imap-config.service && pnpm typecheck`
Expected: PASS (4 tests), no type errors.

- [ ] **Step 10: Commit**

```bash
git add src/features/system
git commit -m "feat(system): add IMAP config CRUD, activate, and connection test"
```

---

## Task 6: Integration credentials

**Files:**
- Create: `src/features/system/dto/create-integration.dto.ts`
- Create: `src/features/system/dto/update-integration.dto.ts`
- Create: `src/features/system/integration-credential.repository.ts`
- Create: `src/features/system/integration-credential.service.ts`
- Create: `src/features/system/integration-credential.controller.ts`
- Modify: `src/features/system/system.module.ts`
- Test: `src/features/system/integration-credential.service.spec.ts`

**Interfaces:**
- Consumes: `EncryptionService`, `SystemAuditService`, `AuditContext`.
- Produces:
  - `interface PublicIntegrationCredential { id; provider; name; kind; meta: Record<string, unknown>; expiresAt: Date | null; isActive; hasSecret: boolean; lastUsedAt: Date | null; lastTestedAt: Date | null; lastTestStatus: string | null; createdAt: Date; updatedAt: Date }`
  - `IntegrationCredentialService.create(dto, ctx)`, `.findById(id)`, `.list({ provider?, page, limit })`, `.update(id, dto, ctx)`, `.remove(id, ctx)`, `.getDecryptedSecret(id): Promise<string>` (internal — not routed).

- [ ] **Step 1: Write the failing test**

Create `src/features/system/integration-credential.service.spec.ts`:

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { IntegrationCredentialService } from './integration-credential.service';

function makeRow(overrides: Record<string, any> = {}) {
  return {
    id: 'c1',
    provider: 'openai',
    name: 'prod',
    kind: 'api_key',
    secretEnc: 'v1.iv.tag.ct',
    meta: { baseUrl: 'https://api.openai.com' },
    expiresAt: null,
    isActive: true,
    lastUsedAt: null,
    lastTestedAt: null,
    lastTestStatus: null,
    createdAt: new Date('2020-01-01'),
    updatedAt: new Date('2020-01-01'),
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  };
}

const ctx = { actorId: 'admin-1', ip: '1.2.3.4', userAgent: 'jest' };

describe('IntegrationCredentialService', () => {
  let repo: any;
  let crypto: any;
  let audit: any;
  let service: IntegrationCredentialService;

  beforeEach(() => {
    repo = {
      create: jest.fn(async (v: any) => makeRow(v)),
      findActiveById: jest.fn(async () => makeRow()),
      findByProviderAndName: jest.fn(async () => null),
      list: jest.fn(async () => ({ rows: [makeRow()], total: 1 })),
      update: jest.fn(async (id: string, patch: any) => makeRow({ id, ...patch })),
      softDelete: jest.fn(async () => undefined),
    };
    crypto = { encrypt: jest.fn(() => 'v1.enc'), decrypt: jest.fn(() => 'sk-secret') };
    audit = { record: jest.fn(async () => undefined) };
    service = new IntegrationCredentialService(repo, crypto, audit);
  });

  it('encrypts the secret on create and redacts it', async () => {
    const res = await service.create(
      { provider: 'openai', name: 'prod', kind: 'api_key', secret: 'sk-raw', meta: {} } as any,
      ctx,
    );
    expect(crypto.encrypt).toHaveBeenCalledWith('sk-raw');
    expect((res as any).secretEnc).toBeUndefined();
    expect(res.hasSecret).toBe(true);
    expect(res.provider).toBe('openai');
  });

  it('rejects a duplicate (provider, name)', async () => {
    repo.findByProviderAndName.mockResolvedValueOnce(makeRow());
    await expect(
      service.create(
        { provider: 'openai', name: 'prod', kind: 'api_key', secret: 'x' } as any,
        ctx,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('404s on a missing credential', async () => {
    repo.findActiveById.mockResolvedValueOnce(null);
    await expect(service.findById('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('decrypts the secret for internal consumers only', async () => {
    const secret = await service.getDecryptedSecret('c1');
    expect(crypto.decrypt).toHaveBeenCalledWith('v1.iv.tag.ct');
    expect(secret).toBe('sk-secret');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- integration-credential.service`
Expected: FAIL — `Cannot find module './integration-credential.service'`.

- [ ] **Step 3: Create the DTOs**

Create `src/features/system/dto/create-integration.dto.ts`:

```ts
import { z } from 'zod';

export const createIntegrationSchema = z.object({
  provider: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  kind: z.enum(['api_key', 'oauth2', 'basic', 'bearer']).default('api_key'),
  secret: z.string().min(1).max(1024),
  meta: z.record(z.string(), z.unknown()).default({}),
  expiresAt: z.coerce.date().optional(),
});

export type CreateIntegrationDto = z.infer<typeof createIntegrationSchema>;
```

Create `src/features/system/dto/update-integration.dto.ts`:

```ts
import { z } from 'zod';
import { createIntegrationSchema } from './create-integration.dto';

export const updateIntegrationSchema = createIntegrationSchema.partial();

export type UpdateIntegrationDto = z.infer<typeof updateIntegrationSchema>;

/** Integration list filter (pagination + optional provider). */
export const integrationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  provider: z.string().min(1).max(100).optional(),
});

export type IntegrationQueryDto = z.infer<typeof integrationQuerySchema>;
```

- [ ] **Step 4: Create the repository**

Create `src/features/system/integration-credential.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import {
  integrationCredentials,
  type IntegrationCredentialRow,
  type NewIntegrationCredentialRow,
} from '../../infrastructure/database/schema/system.schema';

@Injectable()
export class IntegrationCredentialRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(
    values: NewIntegrationCredentialRow,
  ): Promise<IntegrationCredentialRow> {
    const rows = await this.db
      .insert(integrationCredentials)
      .values(values)
      .returning();
    return rows[0];
  }

  async findActiveById(id: string): Promise<IntegrationCredentialRow | null> {
    const rows = await this.db
      .select()
      .from(integrationCredentials)
      .where(
        and(
          eq(integrationCredentials.id, id),
          eq(integrationCredentials.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findByProviderAndName(
    provider: string,
    name: string,
  ): Promise<IntegrationCredentialRow | null> {
    const rows = await this.db
      .select()
      .from(integrationCredentials)
      .where(
        and(
          eq(integrationCredentials.provider, provider),
          eq(integrationCredentials.name, name),
          eq(integrationCredentials.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async list(q: {
    provider?: string;
    page: number;
    limit: number;
  }): Promise<{ rows: IntegrationCredentialRow[]; total: number }> {
    const filters: SQL[] = [eq(integrationCredentials.isDeleted, false)];
    if (q.provider)
      filters.push(eq(integrationCredentials.provider, q.provider));
    const where = and(...filters);
    const rows = await this.db
      .select()
      .from(integrationCredentials)
      .where(where)
      .orderBy(desc(integrationCredentials.createdAt))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    const totals = await this.db
      .select({ value: count() })
      .from(integrationCredentials)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  async update(
    id: string,
    patch: Partial<NewIntegrationCredentialRow>,
  ): Promise<IntegrationCredentialRow | null> {
    const rows = await this.db
      .update(integrationCredentials)
      .set(patch)
      .where(
        and(
          eq(integrationCredentials.id, id),
          eq(integrationCredentials.isDeleted, false),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(integrationCredentials)
      .set({ isDeleted: true, deletedAt: new Date(), isActive: false })
      .where(eq(integrationCredentials.id, id));
  }
}
```

- [ ] **Step 5: Create the service**

Create `src/features/system/integration-credential.service.ts`:

```ts
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service';
import type { IntegrationCredentialRow } from '../../infrastructure/database/schema/system.schema';
import type { CreateIntegrationDto } from './dto/create-integration.dto';
import type { UpdateIntegrationDto } from './dto/update-integration.dto';
import { IntegrationCredentialRepository } from './integration-credential.repository';
import { SystemAuditService } from './system-audit.service';
import type { AuditContext } from './system-audit.types';

export interface PublicIntegrationCredential {
  id: string;
  provider: string;
  name: string;
  kind: IntegrationCredentialRow['kind'];
  meta: Record<string, unknown>;
  expiresAt: Date | null;
  isActive: boolean;
  hasSecret: boolean;
  lastUsedAt: Date | null;
  lastTestedAt: Date | null;
  lastTestStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class IntegrationCredentialService {
  constructor(
    private readonly repo: IntegrationCredentialRepository,
    private readonly crypto: EncryptionService,
    private readonly audit: SystemAuditService,
  ) {}

  private toPublic(
    row: IntegrationCredentialRow,
  ): PublicIntegrationCredential {
    return {
      id: row.id,
      provider: row.provider,
      name: row.name,
      kind: row.kind,
      meta: row.meta,
      expiresAt: row.expiresAt ?? null,
      isActive: row.isActive,
      hasSecret: Boolean(row.secretEnc),
      lastUsedAt: row.lastUsedAt ?? null,
      lastTestedAt: row.lastTestedAt ?? null,
      lastTestStatus: row.lastTestStatus ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async getRow(id: string): Promise<IntegrationCredentialRow> {
    const row = await this.repo.findActiveById(id);
    if (!row) throw new NotFoundException('Integration credential not found');
    return row;
  }

  async create(
    dto: CreateIntegrationDto,
    ctx: AuditContext,
  ): Promise<PublicIntegrationCredential> {
    if (await this.repo.findByProviderAndName(dto.provider, dto.name)) {
      throw new ConflictException(
        `A credential named "${dto.name}" already exists for ${dto.provider}`,
      );
    }
    const row = await this.repo.create({
      provider: dto.provider,
      name: dto.name,
      kind: dto.kind,
      secretEnc: this.crypto.encrypt(dto.secret),
      meta: dto.meta,
      expiresAt: dto.expiresAt,
    });
    await this.audit.record({
      ctx,
      action: 'integration.create',
      entityType: 'integration',
      entityId: row.id,
      metadata: { provider: row.provider, name: row.name, kind: row.kind },
    });
    return this.toPublic(row);
  }

  async findById(id: string): Promise<PublicIntegrationCredential> {
    return this.toPublic(await this.getRow(id));
  }

  async list(q: { provider?: string; page: number; limit: number }) {
    const { rows, total } = await this.repo.list(q);
    return {
      data: rows.map((r) => this.toPublic(r)),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  async update(
    id: string,
    dto: UpdateIntegrationDto,
    ctx: AuditContext,
  ): Promise<PublicIntegrationCredential> {
    await this.getRow(id);
    const patch: Record<string, unknown> = {};
    if (dto.provider !== undefined) patch.provider = dto.provider;
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.kind !== undefined) patch.kind = dto.kind;
    if (dto.meta !== undefined) patch.meta = dto.meta;
    if (dto.expiresAt !== undefined) patch.expiresAt = dto.expiresAt;
    if (dto.secret !== undefined) patch.secretEnc = this.crypto.encrypt(dto.secret);

    const row = await this.repo.update(id, patch);
    if (!row) throw new NotFoundException('Integration credential not found');
    await this.audit.record({
      ctx,
      action: 'integration.update',
      entityType: 'integration',
      entityId: id,
      metadata: { fields: Object.keys(patch).filter((k) => k !== 'secretEnc') },
    });
    return this.toPublic(row);
  }

  async remove(id: string, ctx: AuditContext): Promise<void> {
    await this.getRow(id);
    await this.repo.softDelete(id);
    await this.audit.record({
      ctx,
      action: 'integration.delete',
      entityType: 'integration',
      entityId: id,
    });
  }

  /**
   * Internal use only (NOT routed via HTTP): decrypt the stored secret so a
   * future consumer can call the 3rd-party API.
   */
  async getDecryptedSecret(id: string): Promise<string> {
    const row = await this.getRow(id);
    return this.crypto.decrypt(row.secretEnc);
  }
}
```

- [ ] **Step 6: Create the controller**

Create `src/features/system/integration-credential.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { Principal } from '../../common/principal';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  createIntegrationSchema,
  type CreateIntegrationDto,
} from './dto/create-integration.dto';
import {
  integrationQuerySchema,
  type IntegrationQueryDto,
  updateIntegrationSchema,
  type UpdateIntegrationDto,
} from './dto/update-integration.dto';
import { IntegrationCredentialService } from './integration-credential.service';
import type { AuditContext } from './system-audit.types';

@Roles('admin')
@Controller('system/integrations')
export class IntegrationCredentialController {
  constructor(private readonly integrations: IntegrationCredentialService) {}

  private ctx(user: Principal, ip: string, ua?: string): AuditContext {
    return { actorId: user.id, ip, userAgent: ua ?? null };
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createIntegrationSchema))
    dto: CreateIntegrationDto,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.integrations.create(dto, this.ctx(user, ip, ua));
  }

  @Get()
  list(
    @Query(new ZodValidationPipe(integrationQuerySchema))
    query: IntegrationQueryDto,
  ) {
    return this.integrations.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.findById(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateIntegrationSchema))
    dto: UpdateIntegrationDto,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.integrations.update(id, dto, this.ctx(user, ip, ua));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ): Promise<void> {
    await this.integrations.remove(id, this.ctx(user, ip, ua));
  }
}
```

- [ ] **Step 7: Register in SystemModule**

Edit `src/features/system/system.module.ts` — add imports for `IntegrationCredentialController`, `IntegrationCredentialRepository`, `IntegrationCredentialService`, then add them to `controllers` and `providers`. Also add `IntegrationCredentialService` to `exports` (future consumers need `getDecryptedSecret`).

- [ ] **Step 8: Run tests + typecheck**

Run: `pnpm test -- integration-credential.service && pnpm typecheck`
Expected: PASS (4 tests), no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/features/system
git commit -m "feat(system): add integration credential CRUD with encrypted secrets"
```

---

## Task 7: System settings (cached, typed)

**Files:**
- Create: `src/features/system/dto/upsert-setting.dto.ts`
- Create: `src/features/system/system-settings.repository.ts`
- Create: `src/features/system/system-settings.service.ts`
- Create: `src/features/system/system-settings.controller.ts`
- Modify: `src/features/system/system.module.ts`
- Test: `src/features/system/system-settings.service.spec.ts`

**Interfaces:**
- Consumes: `SystemAuditService`, `AuditContext`, `CACHE_MANAGER` (`Cache`), `SettingValue`.
- Produces:
  - `interface PublicSetting { key: string; value: SettingValue; type: SystemSettingRow['type']; category: string; description: string | null; updatedAt: Date }`
  - `SystemSettingsService.get(key): Promise<PublicSetting>` (404 if missing; cached)
  - `.list({ category?, page, limit })`
  - `.upsert(key, dto, ctx): Promise<PublicSetting>` (invalidates cache)
  - `.remove(key, ctx): Promise<void>` (invalidates cache)
  - typed getters: `.getString(key, def?)`, `.getNumber(key, def?)`, `.getBoolean(key, def?)`, `.getJson<T>(key, def?)`

- [ ] **Step 1: Write the failing test**

Create `src/features/system/system-settings.service.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { SystemSettingsService } from './system-settings.service';

function makeRow(overrides: Record<string, any> = {}) {
  return {
    id: 'set1',
    key: 'app.display_name',
    valueJson: 'Cybernetics',
    type: 'string',
    category: 'general',
    description: null,
    createdAt: new Date('2020-01-01'),
    updatedAt: new Date('2020-01-01'),
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  };
}

const ctx = { actorId: 'admin-1', ip: '1.2.3.4', userAgent: 'jest' };

describe('SystemSettingsService', () => {
  let repo: any;
  let cache: any;
  let audit: any;
  let service: SystemSettingsService;

  beforeEach(() => {
    repo = {
      findByKey: jest.fn(async () => makeRow()),
      list: jest.fn(async () => ({ rows: [makeRow()], total: 1 })),
      upsertByKey: jest.fn(async (key: string, patch: any) => makeRow({ key, ...patch })),
      softDelete: jest.fn(async () => undefined),
    };
    cache = {
      get: jest.fn(async () => undefined),
      set: jest.fn(async () => undefined),
      del: jest.fn(async () => true),
    };
    audit = { record: jest.fn(async () => undefined) };
    service = new SystemSettingsService(repo, cache, audit);
  });

  it('reads through cache and populates it on a miss', async () => {
    const res = await service.get('app.display_name');
    expect(cache.get).toHaveBeenCalledWith('system:setting:app.display_name');
    expect(repo.findByKey).toHaveBeenCalledWith('app.display_name');
    expect(cache.set).toHaveBeenCalledWith(
      'system:setting:app.display_name',
      expect.objectContaining({ key: 'app.display_name', value: 'Cybernetics' }),
      expect.any(Number),
    );
    expect(res.value).toBe('Cybernetics');
  });

  it('returns the cached value without hitting the repo', async () => {
    cache.get.mockResolvedValueOnce({
      key: 'app.display_name',
      value: 'Cached',
      type: 'string',
      category: 'general',
      description: null,
      updatedAt: new Date(),
    });
    const res = await service.get('app.display_name');
    expect(repo.findByKey).not.toHaveBeenCalled();
    expect(res.value).toBe('Cached');
  });

  it('404s on a missing key', async () => {
    repo.findByKey.mockResolvedValueOnce(null);
    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('upserts, audits, and invalidates the cache', async () => {
    await service.upsert(
      'features.signup_enabled',
      { value: true, type: 'boolean' } as any,
      ctx,
    );
    expect(repo.upsertByKey).toHaveBeenCalledWith(
      'features.signup_enabled',
      expect.objectContaining({ valueJson: true, type: 'boolean' }),
    );
    expect(cache.del).toHaveBeenCalledWith('system:setting:features.signup_enabled');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'setting.update', entityType: 'setting' }),
    );
  });

  it('typed getter returns a default when the key is missing', async () => {
    repo.findByKey.mockResolvedValueOnce(null);
    expect(await service.getBoolean('missing', false)).toBe(false);
  });

  it('getNumber returns the stored number', async () => {
    repo.findByKey.mockResolvedValueOnce(makeRow({ valueJson: 42, type: 'number' }));
    expect(await service.getNumber('some.count')).toBe(42);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- system-settings.service`
Expected: FAIL — `Cannot find module './system-settings.service'`.

- [ ] **Step 3: Create the DTO**

Create `src/features/system/dto/upsert-setting.dto.ts`:

```ts
import { z } from 'zod';

/**
 * Upsert a setting. `value` is validated against `type` so the stored JSON and
 * its declared type never diverge.
 */
export const upsertSettingSchema = z
  .object({
    value: z.unknown(),
    type: z.enum(['string', 'number', 'boolean', 'json']),
    category: z.string().min(1).max(100).default('general'),
    description: z.string().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    const ok =
      (data.type === 'string' && typeof data.value === 'string') ||
      (data.type === 'number' && typeof data.value === 'number') ||
      (data.type === 'boolean' && typeof data.value === 'boolean') ||
      (data.type === 'json' &&
        typeof data.value === 'object' &&
        data.value !== null);
    if (!ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: `value does not match declared type "${data.type}"`,
      });
    }
  });

export type UpsertSettingDto = z.infer<typeof upsertSettingSchema>;

/** Settings list filter (pagination + optional category). */
export const settingsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  category: z.string().min(1).max(100).optional(),
});

export type SettingsQueryDto = z.infer<typeof settingsQuerySchema>;
```

- [ ] **Step 4: Create the repository**

Create `src/features/system/system-settings.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, type SQL } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import {
  systemSettings,
  type NewSystemSettingRow,
  type SystemSettingRow,
} from '../../infrastructure/database/schema/system.schema';

@Injectable()
export class SystemSettingsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async findByKey(key: string): Promise<SystemSettingRow | null> {
    const rows = await this.db
      .select()
      .from(systemSettings)
      .where(and(eq(systemSettings.key, key), eq(systemSettings.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(q: {
    category?: string;
    page: number;
    limit: number;
  }): Promise<{ rows: SystemSettingRow[]; total: number }> {
    const filters: SQL[] = [eq(systemSettings.isDeleted, false)];
    if (q.category) filters.push(eq(systemSettings.category, q.category));
    const where = and(...filters);
    const rows = await this.db
      .select()
      .from(systemSettings)
      .where(where)
      .orderBy(systemSettings.key)
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    const totals = await this.db
      .select({ value: count() })
      .from(systemSettings)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  /** Insert or update by key (soft-delete-aware). */
  async upsertByKey(
    key: string,
    patch: Omit<NewSystemSettingRow, 'key'>,
  ): Promise<SystemSettingRow> {
    const existing = await this.findByKey(key);
    if (existing) {
      const rows = await this.db
        .update(systemSettings)
        .set(patch)
        .where(eq(systemSettings.id, existing.id))
        .returning();
      return rows[0];
    }
    const rows = await this.db
      .insert(systemSettings)
      .values({ key, ...patch })
      .returning();
    return rows[0];
  }

  async softDelete(key: string): Promise<boolean> {
    const rows = await this.db
      .update(systemSettings)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(and(eq(systemSettings.key, key), eq(systemSettings.isDeleted, false)))
      .returning();
    return rows.length > 0;
  }
}
```

- [ ] **Step 5: Create the service**

Create `src/features/system/system-settings.service.ts`:

```ts
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import type {
  SettingValue,
  SystemSettingRow,
} from '../../infrastructure/database/schema/system.schema';
import type { UpsertSettingDto } from './dto/upsert-setting.dto';
import { SystemSettingsRepository } from './system-settings.repository';
import { SystemAuditService } from './system-audit.service';
import type { AuditContext } from './system-audit.types';

export interface PublicSetting {
  key: string;
  value: SettingValue;
  type: SystemSettingRow['type'];
  category: string;
  description: string | null;
  updatedAt: Date;
}

@Injectable()
export class SystemSettingsService {
  private readonly ttlMs = 300_000; // 5 minutes (cache-manager ttl is in ms)

  constructor(
    private readonly repo: SystemSettingsRepository,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly audit: SystemAuditService,
  ) {}

  private cacheKey(key: string): string {
    return `system:setting:${key}`;
  }

  private toPublic(row: SystemSettingRow): PublicSetting {
    return {
      key: row.key,
      value: row.valueJson,
      type: row.type,
      category: row.category,
      description: row.description ?? null,
      updatedAt: row.updatedAt,
    };
  }

  /** Cache-through read; undefined if the key does not exist. */
  private async read(key: string): Promise<PublicSetting | undefined> {
    const cached = await this.cache.get<PublicSetting>(this.cacheKey(key));
    if (cached) return cached;
    const row = await this.repo.findByKey(key);
    if (!row) return undefined;
    const pub = this.toPublic(row);
    await this.cache.set(this.cacheKey(key), pub, this.ttlMs);
    return pub;
  }

  async get(key: string): Promise<PublicSetting> {
    const pub = await this.read(key);
    if (!pub) throw new NotFoundException(`Setting "${key}" not found`);
    return pub;
  }

  async list(q: { category?: string; page: number; limit: number }) {
    const { rows, total } = await this.repo.list(q);
    return {
      data: rows.map((r) => this.toPublic(r)),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  async upsert(
    key: string,
    dto: UpsertSettingDto,
    ctx: AuditContext,
  ): Promise<PublicSetting> {
    const row = await this.repo.upsertByKey(key, {
      valueJson: dto.value as SettingValue,
      type: dto.type,
      category: dto.category,
      description: dto.description,
    });
    await this.cache.del(this.cacheKey(key));
    await this.audit.record({
      ctx,
      action: 'setting.update',
      entityType: 'setting',
      entityId: row.id,
      metadata: { key, type: dto.type, category: dto.category },
    });
    return this.toPublic(row);
  }

  async remove(key: string, ctx: AuditContext): Promise<void> {
    const deleted = await this.repo.softDelete(key);
    if (!deleted) throw new NotFoundException(`Setting "${key}" not found`);
    await this.cache.del(this.cacheKey(key));
    await this.audit.record({
      ctx,
      action: 'setting.delete',
      entityType: 'setting',
      metadata: { key },
    });
  }

  // --- Typed getters for internal consumers (return default when missing) ---

  async getString(key: string, def?: string): Promise<string | undefined> {
    const pub = await this.read(key);
    return typeof pub?.value === 'string' ? pub.value : def;
  }

  async getNumber(key: string, def?: number): Promise<number | undefined> {
    const pub = await this.read(key);
    return typeof pub?.value === 'number' ? pub.value : def;
  }

  async getBoolean(key: string, def?: boolean): Promise<boolean | undefined> {
    const pub = await this.read(key);
    return typeof pub?.value === 'boolean' ? pub.value : def;
  }

  async getJson<T>(key: string, def?: T): Promise<T | undefined> {
    const pub = await this.read(key);
    return pub && typeof pub.value === 'object' ? (pub.value as T) : def;
  }
}
```

- [ ] **Step 6: Create the controller**

Create `src/features/system/system-settings.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Ip,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { Principal } from '../../common/principal';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  settingsQuerySchema,
  type SettingsQueryDto,
  upsertSettingSchema,
  type UpsertSettingDto,
} from './dto/upsert-setting.dto';
import { SystemSettingsService } from './system-settings.service';
import type { AuditContext } from './system-audit.types';

@Roles('admin')
@Controller('system/settings')
export class SystemSettingsController {
  constructor(private readonly settings: SystemSettingsService) {}

  private ctx(user: Principal, ip: string, ua?: string): AuditContext {
    return { actorId: user.id, ip, userAgent: ua ?? null };
  }

  @Get()
  list(
    @Query(new ZodValidationPipe(settingsQuerySchema)) query: SettingsQueryDto,
  ) {
    return this.settings.list(query);
  }

  @Get(':key')
  get(@Param('key') key: string) {
    return this.settings.get(key);
  }

  @Put(':key')
  upsert(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(upsertSettingSchema)) dto: UpsertSettingDto,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.settings.upsert(key, dto, this.ctx(user, ip, ua));
  }

  @Delete(':key')
  @HttpCode(204)
  async remove(
    @Param('key') key: string,
    @CurrentUser() user: Principal,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ): Promise<void> {
    await this.settings.remove(key, this.ctx(user, ip, ua));
  }
}
```

- [ ] **Step 7: Register in SystemModule**

Edit `src/features/system/system.module.ts` — add imports for `SystemSettingsController`, `SystemSettingsRepository`, `SystemSettingsService`, add to `controllers`/`providers`, and add `SystemSettingsService` to `exports` (internal consumers use the typed getters). `CACHE_MANAGER` is global, so no import change is needed.

- [ ] **Step 8: Run tests + typecheck**

Run: `pnpm test -- system-settings.service && pnpm typecheck`
Expected: PASS (6 tests), no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/features/system
git commit -m "feat(system): add cached, typed system settings CRUD"
```

---

## Task 8: Build + typecheck + full unit verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full unit suite**

Run: `pnpm test`
Expected: all suites pass, including the new `encryption`, `system.schema`, and five `system/*.service` specs.

- [ ] **Step 2: Typecheck the whole project**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: `nest build` completes with no errors (confirms decorators, DI metadata, and imports resolve).

- [ ] **Step 4: Lint (auto-fix)**

Run: `pnpm lint`
Expected: no remaining lint errors.

- [ ] **Step 5: Commit any lint fixups (if the working tree changed)**

```bash
git add -A
git commit -m "chore(system): lint and formatting for the system module" || echo "nothing to commit"
```

---

## Task 9: End-to-end tests

Boots a module subset (ConfigModule + DatabaseModule + ThrottlerModule + AuthModule + UsersModule + SystemModule) and registers the global guards — never `AppModule` (Mastra's ESM dep breaks Jest). Verifies the HTTP contract: authz matrix, secret redaction, single-active, and settings CRUD.

**Prerequisites:** Postgres + Redis running on the `.env` ports (`:30898` / `:30490`), and the schema migrated: `pnpm db:migrate`.

**Files:**
- Create: `test/system.e2e-spec.ts`

- [ ] **Step 1: Write the e2e spec**

Create `test/system.e2e-spec.ts`:

```ts
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
import { SystemModule } from '../src/features/system/system.module';
import { UsersModule } from '../src/features/users/users.module';
import { UsersService } from '../src/features/users/users.service';
import { DatabaseModule } from '../src/infrastructure/database/database.module';

/**
 * System-records HTTP contract e2e. Requires Postgres (migrated) + Redis.
 * Run with `pnpm test:e2e -- system.e2e`.
 */
describe('System Records API (e2e)', () => {
  let app: INestApplication;
  const stamp = String(Date.now());
  const adminEmail = `sys_admin_${stamp}@e2e.local`;
  const adminPass = 'sys-admin-e2e-password-123';
  const userEmail = `sys_user_${stamp}@e2e.local`;
  const userPass = 'sys-user-e2e-password-123';
  let adminAccess: string;
  let userAccess: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        DatabaseModule,
        ThrottlerModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (c: ConfigService) => {
            const a = c.getOrThrow<AuthConfig>('auth');
            return [{ ttl: a.throttleTtl * 1000, limit: 10_000 }];
          },
        }),
        AuthModule,
        UsersModule,
        SystemModule,
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
    await users.create({ email: adminEmail, password: adminPass, role: 'admin' });
    await users.create({ email: userEmail, password: userPass, role: 'user' });

    adminAccess = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: adminEmail, password: adminPass })
        .expect(200)
    ).body.accessToken;
    userAccess = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: userEmail, password: userPass })
        .expect(200)
    ).body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  const server = () => app.getHttpServer();
  const asAdmin = (r: request.Test) =>
    r.set('Authorization', `Bearer ${adminAccess}`);

  it('rejects unauthenticated access', async () => {
    await request(server()).get('/system/smtp').expect(401);
  });

  it('forbids a non-admin', async () => {
    await request(server())
      .get('/system/smtp')
      .set('Authorization', `Bearer ${userAccess}`)
      .expect(403);
  });

  it('creates an SMTP config and never returns the secret', async () => {
    const res = await asAdmin(request(server()).post('/system/smtp'))
      .send({
        name: 'Primary',
        host: 'smtp.example.com',
        port: 587,
        username: 'mailer',
        secret: 'super-secret-pass',
        secure: true,
        fromAddress: 'no-reply@example.com',
      })
      .expect(201);
    expect(res.body.hasSecret).toBe(true);
    expect(res.body.secret).toBeUndefined();
    expect(res.body.secretEnc).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('super-secret-pass');
  });

  it('enforces a single active SMTP config', async () => {
    const mk = async (name: string) =>
      (
        await asAdmin(request(server()).post('/system/smtp'))
          .send({
            name,
            host: 'smtp.example.com',
            port: 587,
            secure: true,
            fromAddress: 'no-reply@example.com',
          })
          .expect(201)
      ).body.id;
    const a = await mk(`A_${stamp}`);
    const b = await mk(`B_${stamp}`);

    await asAdmin(request(server()).post(`/system/smtp/${a}/activate`)).expect(201);
    await asAdmin(request(server()).post(`/system/smtp/${b}/activate`)).expect(201);

    const list = (await asAdmin(request(server()).get('/system/smtp?limit=100')).expect(200))
      .body.data as Array<{ id: string; isActive: boolean }>;
    const active = list.filter((c) => c.isActive);
    expect(active.length).toBe(1);
    expect(active[0].id).toBe(b);
  });

  it('upserts and reads back a typed setting', async () => {
    await asAdmin(request(server()).put('/system/settings/features.signup_enabled'))
      .send({ value: true, type: 'boolean', category: 'features' })
      .expect(200);
    const res = await asAdmin(
      request(server()).get('/system/settings/features.signup_enabled'),
    ).expect(200);
    expect(res.body.value).toBe(true);
    expect(res.body.type).toBe('boolean');
  });

  it('rejects a setting whose value mismatches its type', async () => {
    await asAdmin(request(server()).put('/system/settings/bad.setting'))
      .send({ value: 'not-a-number', type: 'number' })
      .expect(400);
  });

  it('creates an integration credential with redacted secret', async () => {
    const res = await asAdmin(request(server()).post('/system/integrations'))
      .send({
        provider: 'openai',
        name: `prod_${stamp}`,
        kind: 'api_key',
        secret: 'sk-super-secret',
        meta: { baseUrl: 'https://api.openai.com' },
      })
      .expect(201);
    expect(res.body.hasSecret).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('sk-super-secret');
  });

  it('records audit entries the admin can read', async () => {
    const res = await asAdmin(
      request(server()).get('/system/audit?entityType=smtp&limit=100'),
    ).expect(200);
    expect(res.body.total).toBeGreaterThan(0);
    expect(
      res.body.data.some((r: { action: string }) => r.action === 'smtp.create'),
    ).toBe(true);
    // Audit metadata must never carry secret values.
    expect(JSON.stringify(res.body)).not.toContain('super-secret-pass');
  });
});
```

- [ ] **Step 2: Ensure the schema is migrated, then run the e2e**

Run: `pnpm db:migrate && pnpm test:e2e -- system.e2e`
Expected: all e2e assertions pass (401/403 authz, secret redaction, single-active, settings type validation, audit trail).

- [ ] **Step 3: Commit**

```bash
git add test/system.e2e-spec.ts
git commit -m "test(system): add e2e for authz, redaction, single-active, settings"
```

---

## Self-Review

**1. Spec coverage** — every design section maps to a task:
- §2 Encryption → Task 1. §4 Schemas → Task 2. §5 Audit + module → Task 3.
- §6/§7/§8 SMTP → Task 4; IMAP → Task 5; Integrations → Task 6; Settings → Task 7.
- §9 write-only secrets (redaction, `hasSecret`, internal-only `getDecryptedSecret`), single-active (repo `activate` tx + partial unique index), settings cache, audit — covered across Tasks 4–7 and verified in Task 9.
- §10 testing (unit specs per service + e2e module-subset) → Tasks 1–7 + 9. §11 deferred items are intentionally absent.

**2. Placeholder scan** — no `TBD`/`TODO`/"similar to"/"add validation" placeholders; every code step contains complete code. IMAP is written out fully rather than referencing SMTP.

**3. Type consistency** — `AuditContext`/`RecordAuditInput`/`AuditEntityType` (Task 3) are consumed unchanged by every service. `SettingValue` (Task 2) is used by the settings schema, service, and getters. `EncryptionService.{encrypt,decrypt}` signatures match all call sites. Repository `activate(id)` (Tasks 4–5) matches the service calls. `Cache` (`get`/`set`(ms)/`del`) matches Task 7's usage. Controllers pass `AuditContext` built from `@CurrentUser()` + `@Ip()` + `@Headers('user-agent')` consistently.

**Deferred (v2), intentionally not in this plan:** reveal endpoint, key-rotation tooling, integration-credential live test, per-setting encryption, multi-tenant scoping, OAuth2 refresh.
