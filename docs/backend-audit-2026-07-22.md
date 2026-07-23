# [this is the current on going task](8:12 AM & 22/Jul)

# Backend Architecture Audit — `/api`

**Date:** 2026-07-22
**Branch:** `feat/ai-main-dashboard`
**Scope:** 302 TypeScript files / ~13,055 LOC (non-spec). Full read of every module.
**Stack:** NestJS 11 · Drizzle ORM · BullMQ · MeiliSearch (0.45 CJS) · Mastra AI · Redis (ioredis + cache-manager) · MinIO · Argon2/JWT · Zod (nestjs-zod) · Pino · Sentry.

> The top-severity findings (marked **✓ verified**) were independently confirmed against source, not taken on the analysis pass alone.

---

## Verdict

This is a **genuinely well-engineered codebase** with a small number of real, concentrated problems.

Engineering discipline is high: no file exceeds 500 lines (largest 347), zero `TODO`/`FIXME`/`HACK`/`any`/`@ts-ignore` in non-spec source, `console.*` confined to standalone CLI scripts, and a consistent repository/service/controller layering. The problems are **not** sloppy code — they cluster in five architectural seams:

1. **v1 stubs that are indistinguishable from working features at the API surface** (most dangerous)
2. **Read-then-write without DB-level atomicity** (races that surface as 500s or double side-effects)
3. **Untuned / unhardened backing-store clients and workers** (a dependency hiccup can hang or crash the process)
4. **"Wired but never invoked" self-healing** (reconciliation dead in 2 of 3 modules)
5. **Coarse, identity-blind authorization** (global reads, null-principal collapse, cross-tenant dedup)

**Severity counts:** 2 Critical · 12 High · 15 Medium · ~11 Low.
Nothing here is a rewrite; most fixes are surgical.

---

## 🔴 Critical — correctness / safety

### C1. Scheduled reports run the model but deliver *nowhere* ✓ verified
`features/mastra/processors/agent-run.processor.ts:104-113`, `features/mastra/workflows/scheduled-report.workflow.ts:83`

The `deliver` step comment says *"the processor persists the report into the conversation"*, but the processor's `success` branch only calls `runs.finish({ output })` + `stampRun` — no conversation write, no mailer. Every schedule spends tokens and delivers to the void. `deliveryChannel: 'email'` is worse: it `suspend()`s with **no resume path** ("deferred to v2"), so email schedules hang forever after paying for the model call.

### C2. `db-write` tool reports success (and audit-logs `status:'success'`) for a write that never happens ✓ verified
`features/mastra/tools/db-write.tool.ts:24-38`, `features/mastra/tools/calculate-metric.tool.ts:17-28`

The tool description says *"Performs a real data side-effect"*, it is gated behind human approval, and it records `status: 'success'` — but the body only calls `recordAction()` and returns `{ accepted: true }` ("v1 has no concrete domain to write"). A human approves a write, the audit trail says it succeeded, and **nothing was written.** `calculate-metric` similarly always returns `value: 0, unit: 'unknown'`.

> **Systemic risk:** a v1 stub is indistinguishable from a working feature at the HTTP boundary. "Quarantine" (M12) is a third instance of the same pattern.

---

## 🟠 High

### Security / authorization

**H1. Cross-tenant file read via global checksum dedup (IDOR) ✓ verified**
`features/file-processor/file.repository.ts:22-31`, `features/file-processor/file.service.ts:92-98`
`findAvailableByChecksum` matches **any owner's** AVAILABLE object; `initiateUpload` returns `{ deduplicated: true }` and a readable row **without the caller uploading bytes**. Anyone who knows a file's SHA-256 (e.g. of a shared/published document) obtains a readable copy of another tenant's content plus an existence oracle.

**H2. Null-principal collapse ✓ verified**
`common/principal.ts:15-18`, `features/file-processor/file.service.ts:300-306`
Both `SYSTEM_PRINCIPAL` and `GUEST_PRINCIPAL` have `id: null`. `loadOwned` matches `null === null`, so every guest, every agent/pipeline upload, and every system action share **one `ownerId=null` pool** and can read/delete each other's files.

**H3. Search reads + agent `search-query` tool have no tenant/collection scoping**
`features/search-service/search.controller.ts:17`, `features/mastra/tools/search-query.tool.ts:26`
Any authenticated principal reads any collection; the agent re-exposes this with zero authz, and stored documents flow into model context (prompt-injection surface). Called "intended" in comments but has no explicit decision record.

**H4. DB TLS certificate verification disabled when SSL is on ✓ verified**
`infrastructure/database/database.module.ts:29` (mirrored in `seeders/seed.ts:21`, `drizzle.config.ts:21`)
`ssl: db.ssl ? { rejectUnauthorized: false } : false` — "secure" mode is trivially MITM-able, with no way to opt into real verification.

**H5. Stateless JWT with no revocation channel ✓ verified**
`features/auth/strategies/jwt.strategy.ts:23`
`validate()` trusts claims only, no DB lookup. Logout-all, password change/reset, soft-delete, and role demotion revoke **only refresh sessions** — an outstanding access token keeps full access for up to `JWT_ACCESS_TTL` (900s). After a victim resets their password, a stolen access token still works for ~15 min.

### Robustness / operational

**H6. pg `Pool` is completely untuned ✓ verified**
`infrastructure/database/database.module.ts:23-30`
No `max`, `connectionTimeoutMillis`, or `statement_timeout`. Once the default 10 connections are checked out (easy: BullMQ workers + mailbox ingest + indexing share this one global pool), the next caller **waits forever** instead of failing fast. A runaway query pins a connection indefinitely.

**H7. No `'error'` listener on the pg Pool or ioredis client; no global `unhandledRejection`/`uncaughtException` handler ✓ verified**
`infrastructure/cache/redis.provider.ts:23`, `infrastructure/database/database.module.ts:18-32`
Both are EventEmitters; an idle-connection `'error'` (Redis blip, PG failover) with no listener makes Node **terminate the process**. Rejections in schedulers/processors (outside the HTTP filter's reach) are unguarded.

**H8. Reconciliation sweeps are wired but never invoked — self-healing dead in 2 of 3 modules ✓ verified**
`features/file-processor/schedulers/file-reconciliation.scheduler.ts`, `features/search-service/schedulers/search-reconciliation.scheduler.ts`
Neither implements `OnApplicationBootstrap` nor has any caller (siblings in mailbox / agent-schedule / collection *do*). Stale `PENDING` rows never expire; PG↔Meili drift is never repaired — so the "Postgres is source of truth, Meili is rebuildable" guarantee silently doesn't hold.

**H9. BullMQ workers untuned for their workloads**
`features/mastra/processors/agent-run.processor.ts:41`, `features/file-processor/processors/file-processing.processor.ts`, `features/search-service/processors/search-indexing.processor.ts`
No `concurrency`/`lockDuration`. A model call or large reindex exceeding the 30s default lock is marked stalled → re-delivered → duplicate runs, duplicate token spend, duplicate side-effects.

**H10. HITL double-approval race ✓ verified**
`features/mastra/services/approval.service.ts:42-89`
`decide()` checks `status==='pending'` in JS, performs the side-effect, then does an **unconditional** `UPDATE` (no `WHERE status='pending'`, no version column). Two concurrent approvals (a double-click) both pass and both fire the gated side-effect — defeating HITL entirely.

**H11. IMAP connection-per-operation**
`infrastructure/email/transport/imap.transport.ts:24-35`, `features/mailbox/mailbox-ingest.service.ts:62-77`, `infrastructure/email/email-config.repository.ts:41`
Each of up to 200 UIDs per batch opens a fresh TLS+LOGIN+FETCH+LOGOUT, plus a DB read and an AES-decrypt of the password *per message*. ~200 sequential logins per sync → provider rate-limit bans + N+1 existence queries. The inefficiency is baked into the transport (no "open once, fetch many").

**H12. Orphaned MinIO objects on duplicate/failed mailbox persist**
`features/mailbox/mailbox-ingest.service.ts:131-214`
Raw `.eml` + attachments upload to MinIO *before* the DB transaction, with no compensating delete. A concurrent double-process (or any tx failure) strands the blobs — storage grows unbounded on the error path.

---

## 🟡 Medium

### Concurrency / consistency
- **M1. In-memory Throttler** — `app.module.ts:40`. Per-process, so effective limit = `limit × replicas`, resets on redeploy; weakens login/reset brute-force protection. Redis is available but unwired.
- **M2. `BaseRepository` contradicts the soft-delete contract ✓ verified** — `infrastructure/database/repositories/base.repository.ts:59`. Hard-`DELETE`s and `findById`/`findAll` ignore `isDeleted`, despite `schema/common.ts` documenting soft-delete for all `baseColumns` tables. No `update`/transaction helper either.
- **M3. Read-then-write races (refresh flow ✓ verified)** — refresh rotation → two live sessions (`auth.service.ts:74`); `system_settings` upsert (`system-settings.repository.ts:51`); record `externalId` upsert (`search-record.service.ts:100`). All check-then-insert with no conditional `UPDATE`/`ON CONFLICT` → unhandled unique-violation 500s.
- **M6. Reindex clears the index before repopulating** — `search-indexing.processor.ts:98`. Live query-outage window during every field-spec update; stale docs also survive a failed `deleteIndex` (`collection.service.ts:161`).

### Error handling / boundaries
- **M4. Search abstraction leaks raw MeiliSearch errors on the hot path** — `infrastructure/search-engine/search-engine.service.ts:59-131`. Only `ensureIndex` wraps errors; an invalid filter from `search()` becomes a 500 instead of a 4xx.
- **M5. `objectExists` swallows *all* errors as `false`** — `infrastructure/file-manage/object-storage.service.ts:130`. A MinIO outage is indistinguishable from "absent," so callers make wrong decisions during an outage.
- **M7. `/health` is public and echoes raw dependency error strings** — `infrastructure/health/health.controller.ts`. Info disclosure; also a single aggregated probe serves both liveness and readiness (a Redis blip → 503 → pod restart loop).

### Auth hardening
- **M8. No `trust proxy`** — `main.ts`. Behind an LB, `req.ip` is the proxy, so throttle buckets all clients together and every audit/session IP is wrong.
- **M9. No timeout/AbortSignal on model calls** — `features/mastra/services/agent-runner.service.ts:74`. A hung gateway pins the HTTP connection indefinitely.
- **M10. Forgot-password timing enumeration** — `features/auth/password-reset.service.ts:40`. The `request()` path isn't timing-equalized (the `reset()` path deliberately is, via a decoy hash), reopening the oracle the decoy closed.
- **M11. Post-approval continuation discarded** — `features/mastra/services/approval.service.ts:62`. `resumeAfterApproval` returns void; new text or a new pending approval from the resumed turn is silently lost.

### File pipeline
- **M12. "Quarantine" is not malware scanning** — `features/file-processor/processors/file-processing.processor.ts:52`, `config/configurations/storage.config.ts:28`. SHA-256 + a 4-byte magic sniff for ~6 types; unknown signatures pass, and the MIME allowlist **defaults to allow-any** when `FILE_ALLOWED_MIME` is empty.
- **M15. `completeUpload` trusts client SHA-256 before verification** — `features/file-processor/file.service.ts:158`. Brief window where a lied-about checksum is AVAILABLE + downloadable.

### Data model / performance
- **M13. N+1 sequential writes in bulk record persist** — `features/search-service/search-record.service.ts:96`. Up to ~3×1000 awaited round-trips, no batching.
- **M14. IMAP `uid` stored as `int4`** — `infrastructure/database/schema/mailbox.schema.ts:34`. IMAP UIDs are unsigned 32-bit; will overflow `integer`'s 2.1B max on long-lived mailboxes. (`uidValidity` correctly uses `bigint`.)

---

## ⚪ Low / hygiene
- **L1.** Encryption key-version envelope is parsed but never used for key selection — bumping the version makes all existing `v1` secrets undecryptable (rotation implied, not implemented). — `infrastructure/crypto/encryption.service.ts:47`
- **L2.** Dead `ExampleProcessor`/`ExampleScheduler` registered as **live providers** — a no-op worker on the `default` queue in every environment. — `infrastructure/queue/`
- **L3.** `main.ts:33` reads `process.env.PORT` directly; `config/configurations/mailbox.config.ts` bypasses the central env schema (so `MAILBOX_*` vars are never validated at boot).
- **L4.** Full env schema Zod-parsed ~12× at boot (each `registerAs` re-parses everything).
- **L5.** No FK constraints on mailbox/file/search tables (referential integrity app-enforced only; `agent`/`identity` schemas do use FKs).
- **L6.** `page`/`limit` schema copy-pasted across 4 DTOs (`list-query.dto.ts`, `update-integration.dto.ts`, `upsert-setting.dto.ts`, `users/dto/list-users.dto.ts`).
- **L7.** No last-admin / self-lockout guard — an admin can demote/delete the only admin (`user.repository.ts:84` `countByRole` exists but is never called); email is immutable via update.
- **L8.** `session.lastUsedAt` is never populated — dead column, misleading "last active" in the sessions UI. — `auth.service.ts:149`
- **L9.** SMTP/IMAP `test` returns the raw transport error to the client. — `smtp-config.service.ts:186`, `imap-config.service.ts:176`
- **L10.** `presignedGetUrl` filename sanitization only strips `"` — control/non-ASCII bytes unhandled. — `object-storage.service.ts:85`
- **L11.** IMAP client sets no socket/greeting timeout (SMTP transport does). — `imap.transport.ts:14`

---

## What's genuinely excellent (preserve)

- **Exception subsystem** — declarative `ERROR_REGISTRY` + `ErrorEnvelope` that hides internal messages for `INTERNAL` kind + SQLSTATE/Redis/MinIO/crypto/Mastra boundary mappers + correlation-id propagation + Sentry capture only for non-client errors.
- **Boot-time config validation** — `env.validation.ts` `superRefine` rejects the default JWT secret, all-zero encryption key, default MinIO creds, weak pepper, and missing prod keys; fails fast with a readable list.
- **Auth** — refresh-token rotation with family-wide theft revocation; opaque refresh tokens stored only as SHA-256; uniform 401s (no user enumeration); password change revokes all sessions.
- **Crypto** — AES-256-GCM with a fresh random 12-byte IV per message, auth-tag verification, 32-byte key enforced at construction, decrypt errors *thrown* not swallowed.
- **Password reset** — peppered constant-time HMAC, single-live-code, attempt lockout, fully enumeration-safe `reset()` path.
- **Secret hygiene** — secrets never leave the service layer (`hasSecret` projections, `getDecryptedSecret` non-HTTP); audit records changed field *names* only; Pino redacts auth headers + `req.body.password`.
- **Search** — filter-injection defense via strict attribute allowlist + escaping; reserved-field-name protection; PG-source-of-truth / Meili-rebuildable split; `waitForTask` awaited after every mutation.
- **DI correctness** — Mastra `registerAsync` resolves repositories from `MastraRepositoriesModule` (the documented provider-resolution pitfall handled correctly); adapter casts quarantined to one file.
- **Bootstrap** — correct global guard order (throttle → authenticate → authorize); OpenAPI docs mounted outside the guard pipeline and gated by `OPENAPI_ENABLED`; graceful shutdown hooks for pool/Redis/queues.

---

## Proposed remediation ordering

| Track | Items | Rationale |
|-------|-------|-----------|
| **P0 — Truth-in-API** | C1, C2, M12, H8 | Make stubs fail loudly (`NOT_IMPLEMENTED`/remove from registry) or implement them; wire the two reconciliation schedulers (code already exists). Removes the "reports success but did nothing" hazard. Smallest surface. |
| **P1 — Production robustness** | H6, H7, H9, H4, M1 | Pool tuning + error listeners + global handlers + worker locks + TLS verify + Redis-backed throttler. Mostly config; biggest "survives production" payoff. |
| **P2 — Security hardening** | H1, H2, H5, H3, M8, M10 | Owner-scope dedup, split null principals, token revocation (`jti`/version deny-list), per-collection authz. Highest-stakes if multi-tenant / external is near. |
| **P3 — Concurrency correctness** | H10, M2, M3, M6 | Conditional updates / `ON CONFLICT` / transactions. H10 + M3 share one pattern. |
| **P4 — Efficiency & hygiene** | H11, H12, M14, all L-items | Mailbox connection reuse; then the Low batch. |

**Overlaps worth fixing together:** M3 + H10 (single read-then-write pattern); H8 is one small change touching both file + search modules.

---

*Findings produced by full-codebase read with independent source verification of all Critical/High items. No code was modified during the audit.*
