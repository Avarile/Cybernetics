import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
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
  string | number | boolean | Record<string, unknown> | unknown[];

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
    secretEnc: text('secret_enc'),
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
    secretEnc: text('secret_enc'),
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
    secretEnc: text('secret_enc').notNull(),
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
export type IntegrationCredentialRow =
  typeof integrationCredentials.$inferSelect;
export type NewIntegrationCredentialRow =
  typeof integrationCredentials.$inferInsert;
export type SystemSettingRow = typeof systemSettings.$inferSelect;
export type NewSystemSettingRow = typeof systemSettings.$inferInsert;
export type SystemAuditRow = typeof systemAuditLog.$inferSelect;
export type NewSystemAuditRow = typeof systemAuditLog.$inferInsert;
