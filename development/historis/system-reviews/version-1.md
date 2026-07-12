
# Cybernetics — Architecture, Design & Best-Practices Review

**Repository:** `Cybernetics` — modular NestJS 11 application (TypeScript, Node ≥20)
**Branch reviewed:** `dev` (`988a0f3`)
**Date:** 2026-07-13
**Scope:** whole codebase — 74 source files (4,217 LoC), 9 unit specs, 4 e2e specs
**Method:** direct read of every core file + five parallel subsystem audits (file-processor, search+engine, db/cache/queue, config/bootstrap/health, tests/tooling). Security-critical paths (auth resolution, owner-scoping, dedup, engine error handling, base repository) were read and verified firsthand.

---

## 1. Executive Summary

Cybernetics is a **high-quality, deliberately engineered NestJS modular monolith**. The layering is clean, dependency injection is idiomatic and consistent, configuration is fully validated and fail-fast, observability is correctly wired, and the code is small-file, well-commented, and TDD-backed where tests exist. On fundamentals this is well above the average NestJS codebase.

The material weaknesses cluster into **four themes**, only some of which are already tracked in `current_goal`:

1. **Authentication/authorization is an explicit, deferred placeholder** — and its "no identity ⇒ system principal" default is *fail-open* rather than fail-closed. (Known/tracked, but the fail-open direction deserves elevation.)
2. **A cross-tenant content-disclosure path in file dedup** that is *not* owner-scoped — a genuine isolation bug that survives even after real auth lands. **(New — highest-value finding.)**
3. **Production-hardening gaps** — no HTTP hardening (CORS/helmet/rate-limit), TLS verification disabled on Postgres, no queue failure/DLQ handling, an unwrapped-error path that defeats graceful degradation, and health probes that need liveness/readiness split + timeouts. (New.)
4. **Test breadth + delivery gaps** — the security-critical file-processing pipeline is untested, there is no CI, and `app.e2e-spec.ts` is broken. (Partly new.)

**Verdict:** *Architecturally sound and production-*shaped*, not yet production-*ready*.* None of the issues are structural — they are additive hardening, one real dedup bug, and coverage. The design is built to absorb the fixes without refactoring (the auth guard slots in behind an existing decorator seam; the search index registry is open/closed; storage/search are interface-abstracted).

### Scorecard

| Dimension | Grade | Note |
|---|---|---|
| Project structure & layering | **A** | Clean `config`/`common`/`infrastructure`/`features` separation; load-bearing composition root is documented |
| Dependency injection & abstractions | **A−** | Symbol tokens, typed config factories, interface-first infra (`OBJECT_STORAGE`, `SEARCH_ENGINE`) |
| Configuration & env management | **A** | Zod fail-fast, boolean-coercion footgun handled, prod credential guards |
| Observability & logging | **A−** | Correct Sentry ordering, Pino redaction, real health probes |
| Data layer (schema & migrations) | **A−** | Timezone-aware, indexed, soft-delete convention, checked-in migrations |
| Repository abstraction | **B−** | Base repo contradicts the soft-delete contract; no transaction support |
| Async / queue engineering | **B** | Per-job options good in features; default-queue template weak, no DLQ/failure handling |
| Input validation & injection defense | **A−** | Zod at every boundary, allowlisted filter/sort/facet fields, escaped values |
| AuthN / AuthZ | **D** (deferred) | Placeholder; spoofable header; fail-open to system principal |
| Cross-tenant isolation | **C** | Owner-scoping is solid *except* dedup bypasses it (real bug) |
| Testing | **B−** | Excellent where present; broad gaps; no CI; one broken e2e |
| Production HTTP hardening | **C** | No CORS/helmet/throttler; TLS verify off; health probe hardening needed |
| Code hygiene | **A** | Every file < 500 lines; intent-level comments; consistent naming |

---

## 2. Project Overview

A backend platform combining **file management** (presigned MinIO uploads with content-addressed dedup and async verification), **full-text search** (MeiliSearch, owner-scoped), and an **AI agent layer** (Mastra), over Postgres (Drizzle ORM), Redis (cache + sessions + BullMQ), with Sentry + Pino observability and Terminus health checks.

**Stack:** NestJS 11 · TypeScript 5.9 (SWC build) · Drizzle ORM 0.45 + `pg` · MeiliSearch 0.45 (CJS-pinned) · BullMQ 5 · MinIO 8 · Mastra 1.5 · Zod 3 · Pino · Sentry · pnpm.

---

## 3. Architecture & Structure

### Layering (assessment: excellent)

```
src/
├── main.ts / instrument.ts        # bootstrap (Sentry-first, Pino, shutdown hooks)
├── app.module.ts                  # composition root (documented import order)
├── config/                        # typed, Zod-validated env → namespaced config
├── common/                        # cross-cutting: Principal, ZodValidationPipe, CurrentUser
├── infrastructure/                # technical capabilities (swappable, @Global)
│   ├── database/  (Drizzle + pg, base repository, schema, migrations, seeders)
│   ├── cache/     (Keyv/Redis cache + session cache)
│   ├── queue/     (BullMQ root + example processor/scheduler)
│   ├── file-manage/ (OBJECT_STORAGE abstraction over MinIO)
│   ├── search-engine/ (SEARCH_ENGINE abstraction over MeiliSearch)
│   ├── health/    (Terminus indicators: db, redis, meili, minio)
│   ├── logger/    (Pino)
│   └── observability/ (Sentry module)
└── features/                      # business slices (depend on infra abstractions)
    ├── file-processor/ (controller, service, repository, processors, schedulers)
    ├── search-service/ (controller, service, index-registry, processors, schedulers)
    └── mastra/         (AI agent scaffold)
```

**What's strong:**
- **Dependency direction is correct** — features depend on infrastructure *interfaces* (`ObjectStorage`, `SearchEngine`) via symbol tokens, never on the concrete SDK. MeiliSearch and MinIO SDK usage is each confined to a single file.
- **The composition root is honest about its constraints** (`app.module.ts:16-21`): `ObservabilityModule` first (so Sentry instruments everything), `MastraModule` last (its catch-all controller would otherwise hijack routes). This ordering is *documented*, which is rare and welcome.
- **Feature/infra split mirrors itself** — the search feature (`features/search-service`) is cleanly separated from the search capability (`infrastructure/search-engine`), so the engine is reusable and the feature is testable in isolation.

**Structural risks:**
- **F-1 (MEDIUM):** The Mastra catch-all-ordering invariant is enforced *only* by array position + a comment (`app.module.ts:44-45`, `mastra.module.ts:13`). An import sorter or alphabetizer silently reintroduces route hijacking with no failing test. → Mount Mastra under an explicit path prefix, or add an e2e asserting a non-Mastra route still resolves.
- **F-2 (LOW):** `session-cache.module.ts` depends implicitly on `REDIS_CLIENT` being a `@Global` export from `CacheModule` without importing it — silent breakage if that globality ever changes.

---

## 4. Design Patterns — Catalogue & Assessment

| Pattern | Where | Assessment |
|---|---|---|
| **Provider factory + typed config** | every infra module (`database.module.ts:18`, `redis.provider.ts:18`, `queue.module.ts:17`) | ✅ Textbook. `useFactory` injects `ConfigService`, reads a typed namespace via `getOrThrow<T>()`, no `process.env` in providers. |
| **Interface segregation + DI token** | `OBJECT_STORAGE`, `SEARCH_ENGINE` (`useClass` binding) | ✅ Genuine — features depend on the token/interface; backends are swappable. |
| **Repository pattern** | `BaseRepository<T>` + `FileRepository` | ⚠️ Good split (generic CRUD in base, domain queries in feature) but base **violates the soft-delete contract** and has **no transaction support** (see D-1, D-2). |
| **Registry / open-closed** | `IndexRegistry` via `SEARCH_INDEX_DEFINITIONS` token | ✅ Excellent — new indexes plug in via one registry entry; duplicate-name detection fails fast at construction. |
| **Pipe-based boundary validation** | `ZodValidationPipe` + `ParseUUIDPipe` | ✅ Correct — validates *and* transforms, returns structured 400 `issues[]`, re-throws non-Zod errors. |
| **Async worker + idempotent jobs** | file & search processors | ✅ Search worker awaits Meili task convergence; keyed by primary key so retries are safe. ⚠️ File worker doesn't validate payload (see below). |
| **Lifecycle hooks for teardown** | `OnApplicationShutdown` on pg pool & Redis client | ✅ Wired *and* `enableShutdownHooks()` is actually called — a commonly-forgotten step. ⚠️ Keyv cache store is *not* closed (see D-4). |
| **Content-addressed storage + ref-counted purge** | `file.service.ts`, `file.util.ts` | ✅ Mechanism is sound (sharded keys, purge gated on live references). ⚠️ Dedup lookup itself is not owner-scoped (see S-1). |
| **Placeholder seam for deferred auth** | `CurrentUser` decorator + `Principal` | ⚠️ Good seam (signatures won't change when a guard lands) but the *default* is fail-open (see S-2). |

---

## 5. What Is Genuinely Well Done

- **Environment validation (`env.validation.ts`) is exemplary.** Zod schema with fail-fast aggregated errors; the `Boolean('false') === true` footgun is explicitly defused via `preprocess` (`:7-10`, with a regression test); production `superRefine` guards *reject default MinIO credentials* and *require a Meili master key* when `NODE_ENV=production` (`:80-105`). One source of coercion, reused by the app and the standalone seed runner.
- **Owner-scoping and injection defense in search** (`search.service.ts:153-208`) — filter/sort/facet **field names are allowlisted** against registered attributes (no field-name injection surface), values are **quote-escaped**, users are **explicitly forbidden from filtering on the owner attribute** (no scope-widening), and there is a dedicated **filter-injection containment unit test**.
- **Defense-in-depth on file size** — enforced at three layers: Zod DTO, the presigned-POST content-length-range at the edge, and a re-`stat` on completion with rollback.
- **Memory-efficient verifier** — the file processor computes SHA-256 and captures the magic-byte header in a *single* stream pass, and MIME sniffing is conservative (only flags positive contradictions; treats the ZIP/OOXML/ODF family as compatible to avoid false quarantines).
- **Correct Sentry/observability bootstrap** — `import './instrument'` is the literal first line of `main.ts`; instrument reads raw env (correct, pre-ConfigModule) and no-ops without a DSN; `SentryGlobalFilter` registered as first `APP_FILTER`; Pino redacts `authorization`/`cookie`/`set-cookie`; `sendDefaultPii` left at its safe default.
- **Real health probes** — `SELECT 1`, Redis `PING` with assertion, Meili `isHealthy()`, MinIO `bucketExists` on the *configured* bucket — against injected clients, not stubs.
- **Schema quality** — timezone-aware timestamps, typed `jsonb NOT NULL DEFAULT '{}'`, purpose-built indexes (owner, checksum, composite `status+created_at`), a reusable `baseColumns` soft-delete convention, checked-in deterministic drizzle migrations run out-of-band (not auto-migrate-on-boot).
- **Secret & repo hygiene** — `.env` gitignored and confirmed untracked; only `.env.example` (placeholders) is committed; pnpm lockfile + `packageManager` pinned; query logging gated to non-production.
- **Code hygiene** — every file is well under the 500-line rule (largest: `file.service.ts` at 345), comments explain *intent* not mechanics, and load-bearing decisions are documented inline.

---

## 6. Findings (Consolidated, Prioritized)

> Findings are deduplicated across the five audits. Auth appeared in three reports and is consolidated under **S-2/S-3**. Severity reflects impact assuming the app is exposed; items explicitly deferred in `current_goal` are marked **[tracked]**.

### 🔴 Security & Correctness — must fix before any exposure

**S-1 — Checksum dedup is not owner-scoped → cross-tenant content disclosure. [NEW]**
`file.repository.ts:22-31` (`findAvailableByChecksum`) + `file.service.ts:307-331` (`tryDedup`).
Any caller may supply a `sha256`. `tryDedup` matches *any* AVAILABLE object with that hash **regardless of owner** and mints a new row owned by the requester pointing at the existing object, `status: 'AVAILABLE'`. The requester then calls `getDownloadUrl` and receives another tenant's bytes. SHA-256 is not a secret (derivable for shared/known/leaked files), so knowing the hash yields both existence-confirmation and retrieval. **This survives real auth** — an authenticated attacker acting as themselves still crosses tenants. → Scope dedup to the same `ownerId`, or require proof-of-possession (actual upload + verification) before binding.

**S-2 — Auth is a spoofable header that fails *open* to the system principal. [tracked, but elevate]**
`current-user.decorator.ts:16-17` trusts `x-user-id` verbatim; an absent/empty header resolves to `{ id: null }` = `SYSTEM_PRINCIPAL`. There are **zero guards** in `src/` (no `@UseGuards`, no `CanActivate`, no passport/jwt deps). Two consequences:
- *Horizontal impersonation:* any client sets `x-user-id: <victim>` and reads that user's data — the ownership check in `loadOwned` is fully defeated.
- *Fail-open escalation:* sending **no** header searches across **all owners** (`search.service.ts:159` skips the owner filter when `principal.id === null`). Sending *no* credential grants *broader* access than sending one.
The decorator is a documented placeholder and the seam is well-designed — but as wired it is an open IDOR/broken-access-control on every route. → Implement a real `AuthGuard`; **and independently**, make missing identity fail *closed* even in the placeholder.

**S-3 — Root cause: one `id: null` sentinel conflates "trusted system caller" with "anonymous." [NEW — design]**
`principal.ts:2-7` + `search.service.ts:159`. Even after a guard lands, any future path yielding `{ id: null }` for an anonymous user inherits full unscoped access. → Use a discriminated principal (`{ kind: 'system' }` vs `{ kind: 'user', id }` vs `{ kind: 'anonymous' }`) so *anonymous can never equal system*. This outlives the placeholder decorator.

**S-4 — `AVAILABLE` is granted before verification, and deduped rows are never verified at all. [NEW]**
`file.service.ts:162-169` (complete → mark AVAILABLE, *then* enqueue) and `:254-266` (`putFromStream` writes AVAILABLE directly). The schema comment (`file.schema.ts:16`) promises "AVAILABLE = upload verified," but checksum/MIME verification runs later in the queue — **and deduped rows (`tryDedup`) are never enqueued**, so they can permanently reference content that never matched its declared checksum. → Introduce an intermediate `PROCESSING`/`SCANNING` state (or a `verifiedAt` gate on downloads *and* dedup eligibility).

**S-5 — Engine read/mutation errors are unwrapped → the 503 graceful-degradation path is dead and raw Meili errors leak to clients. [NEW]**
`search-engine.service.ts:95-126` (`search`) throws *raw* `meilisearch` errors; only `ensureIndex`/`waitForTask` produce `SearchEngineError`. So `search.service.ts:102` (`if (error instanceof SearchEngineError)`) almost never matches — a Meili outage becomes a **500 with raw internals**, not the intended 503. The unit test mocks the engine throwing `SearchEngineError` (a behavior the real engine never exhibits), giving false confidence. → Wrap all engine methods in `this.wrap(...)`.

### 🟠 Production hardening — fix before production

**P-1 — No HTTP hardening. [NEW]** `main.ts` calls no `enableCors`, `helmet`, global `ThrottlerGuard`, or global `ValidationPipe`; none of those packages are installed. With every route unauthenticated, there is no rate limit on presigned-URL issuance or search, and no security headers. → Add helmet, a CORS policy, and a throttler (at minimum on presign + search).

**P-2 — Postgres TLS verification is disabled. [NEW]** `database.module.ts:29` and `seed.ts:21` use `ssl: { rejectUnauthorized: false }` — encrypted but MITM-able (the classic "SSL on but not verified" trap). → Make it config-driven with CA support; default to verifying.

**P-3 — Queue default template has no retry/backoff/trim and no failure handling. [NEW]** `queue.module.ts:31` (`registerQueue({ name: DEFAULT_QUEUE })`) sets no `defaultJobOptions` → `attempts=1` (no retry) and completed/failed jobs retained forever (unbounded Redis growth). `example.processor.ts` has no `@OnWorkerEvent('failed')`, no Sentry capture, no DLQ. *(Note: the real feature queues in `file.service.ts:338` and `search.service.ts:138` do set attempts/backoff/trim correctly — the gap is the template others will copy, plus the missing failure→observability path everywhere.)* → Set `defaultJobOptions`; add a `failed` handler feeding Sentry / a dead-letter path.

**P-4 — Production credential guards are inconsistent. [NEW]** `env.validation.ts:80-105` rejects default MinIO/Meili creds in prod but has **no equivalent for `DATABASE_PASSWORD`** (defaults `'postgres'`) or **`REDIS_PASSWORD`** (defaults `''` → no AUTH). Sessions then sit in an unauthenticated Redis. → Add prod guards for DB/Redis credentials (and consider requiring `DATABASE_SSL` in prod).

**P-5 — Health endpoint needs liveness/readiness split, timeouts, and error redaction. [NEW]** `health.controller.ts:27` is one combined `/health`. Issues: (a) used as *liveness* it restarts a healthy process on a transient dependency outage — split liveness (process) from readiness (dependencies); (b) no probe has a timeout, so a half-open TCP connection hangs `/health` forever (`database.health.ts:23`, etc.); (c) indicators return `(error as Error).message` on a public endpoint, leaking internal hostnames/ports — return a generic message and log detail server-side.

**P-6 — Facets are validated against raw `filterableAttributes`, not `allowedFilterFields`. [tracked]** `search.service.ts:192-202` lets a caller facet on the owner attribute (excluded from filters at `:167`). For a scoped user this is contained by Meili's owner-filtered counts, but for a `null`/system principal (i.e. the S-2 fail-open case) it enumerates all owner IDs and counts. → Validate facets against `allowedFilterFields` (or a dedicated `allowedFacetFields`); reject the owner attribute as filters do.

### 🟡 Data layer & robustness

**D-1 — Base repository violates the soft-delete contract. [NEW]** `base.repository.ts:59-61` `deleteById` does a **hard** `db.delete`; `findAll`/`findById` do **not** filter `is_deleted = false` — contradicting `common.ts:25-26`. *(FileService compensates by manually checking `row.isDeleted` in `loadOwned`, so it's latent today, but any new repo extending the base silently violates the model.)* → Make the base honor soft-delete, or drop the columns.

**D-2 — No transaction support in the repository layer. [NEW]** `base.repository.ts` binds to the root `db`; there's no way to pass a Drizzle tx handle, so multi-step mutations (e.g. `file.service.ts:151-160` oversize rollback; the reconcile purge loop) aren't atomic. → Add tx-aware repository methods / a unit-of-work seam.

**D-3 — No unique constraint on `(bucket, object_key)`. [NEW]** `file.schema.ts:36-37` — the content-addressing invariant the comment promises is unenforced; duplicate object keys are insertable. → Add a unique index.

**D-4 — Keyv/Redis cache store is never closed on shutdown. [NEW]** `cache.module.ts:22-33` opens a Redis connection with no teardown hook (the pg pool and shared ioredis both have one). Leaks a socket on shutdown/hot-reload/tests. → Add an `OnApplicationShutdown` that disconnects it.

**D-5 — `putFromStream` bypasses the size cap when `size` is unknown. [NEW]** `file.service.ts:227-252` — `assertPolicy` only enforces `maxFileSize` when `size !== undefined`, and there is no post-write size check on the direct path (the external POST path *is* capped). An oversized in-process stream is fully persisted. → Enforce a post-write `stat` size check and abort/delete on overflow.

**D-6 — File-processing job payload isn't validated at the worker boundary. [NEW]** `file-processing.processor.ts:40` casts `job.data as {fileId}` — the sibling `search-indexing.processor.ts:62-83` validates its payload (added deliberately in `7f9916b`). BullMQ jobs are persisted/replayable. → Add the same assertion pattern.

**D-7 — Reconciliation scheduler is not wired at boot, and its storage lifecycle rule targets the wrong prefix. [NEW]** `file-reconciliation.scheduler.ts:6-11` must be invoked from an ops hook that may never fire; `init-minio.ts:41-50` expires only `tmp/` but uploads land under `uploads/`/`sha256/` — so the storage-side backstop is inert and orphans/stale-PENDING rows accumulate. → Wire the scheduler (drive interval from config); fix the lifecycle prefix.

**D-8 — Several partial-failure / N+1 / race issues in reconciliation.** Non-atomic AVAILABLE-transition→enqueue with no recovery path (`file.service.ts:162-168`); dedup-vs-purge TOCTOU (`file.service.ts:316` vs `file-processing.processor.ts:105`); unbounded N+1 stale-expiry loop. → Batch the stale `UPDATE`; guard purge/dedup with a transaction or re-check.

**D-9 — Indexing worker auto-creates ghost indexes; reindex is destructive-first.** `search-indexing.processor.ts` validates the registry only for `reindex`, not for `index-docs`/`delete-docs` — an unregistered index name makes Meili auto-create a settings-less index (`:32-49`). Separately, reconcile does `clearIndex` → re-add (`:91-97`), leaving an empty-index window and risking permanent emptiness on partial failure. → Registry-check all job branches; prefer build-temp-then-`swapIndexes`.

### 🔵 Testing & delivery

**T-1 — No CI. [NEW]** No `.github/workflows` (or any CI). Nothing runs lint/typecheck/build/test automatically; every gate is local-only. Highest-leverage delivery gap.

**T-2 — The security-critical file-processing pipeline is untested. [NEW]** `file-processing.processor.ts` (checksum verify, quarantine, stale-pending expiry, orphan purge) has *zero* tests, while its search-side twin is tested. Also untested: controllers, repositories, `ZodValidationPipe`, object-storage service, 3/4 health indicators, config factories, DTO schemas.

**T-3 — `app.e2e-spec.ts` is broken and misleading. [NEW]** `test/app.e2e-spec.ts:17` boots the full `AppModule` → `MastraModule` → an ESM dep the e2e SWC transform can't handle — the exact thing the other three specs subset-boot to avoid. It will fail to boot and silently masks that the full app is never exercised e2e.

**T-4 — Weakened static-analysis posture. [NEW]** `tsconfig.json` enables only `strictNullChecks`/`noImplicitAny`/`strictBindCallApply`, **not** `strict: true` (NestJS default) — missing `strictFunctionTypes`, `strictPropertyInitialization`, etc., which matters given the casts in the base repo. `eslint.config.mjs:27-29` turns `no-explicit-any` **off** and downgrades `no-floating-promises`/`no-unsafe-argument` to `warn` (risky in an async/queue-heavy app), with no `--max-warnings 0` gate. `jest.config.js` has **no `coverageThreshold`** (coverage reported, never enforced) and `collectCoverageFrom` includes declarative files, inflating the denominator.

**T-5 — Live-service e2e specs have no skip/guard. [NEW]** queue/search/search-engine specs hard-fail (rather than skip) without live Redis/Meili; combined with T-1 the e2e suite is run-by-hand only.

### ⚪ Lower-severity / polish

- **Dead `sentryConfig` namespace** loaded but injected nowhere; real `Sentry.init` reads raw env and bypasses Zod (`SENTRY_TRACES_SAMPLE_RATE` → `NaN` on bad input). Also no `Sentry.close()` flush on shutdown, and `SENTRY_DSN` isn't URL-validated. (`sentry.config.ts`, `instrument.ts`, `main.ts:14`)
- **`main.ts:16`** reads `process.env.PORT` directly instead of the validated `app.port` — the one runtime `process.env` leak outside `config/`.
- **`objectExists` swallows all errors as "false"** (`object-storage.service.ts:130-137`) → a transient MinIO failure masquerades as "not found."
- **Env parsed ~7×** at boot (once via `forRoot({validate})`, again in each `registerAs`). Harmless, redundant.
- **`REDIS_CLIENT` is a string token** while DB tokens are Symbols — inconsistent, collision-prone.
- **Cache, sessions, and BullMQ share one Redis logical DB** — prefixes prevent collisions but a `FLUSHDB`/eviction affects all three.
- **Search polish:** `highlight`/`attributesToRetrieve` not allowlisted (no projection → indexed fields all returned); no `q` length or `page` upper bound; engine `health()` duplicated by the health indicator instead of reused; magic `1000` maxTotalHits; no `jobId` dedupe on repeated `reindex`.
- **Missing MeiliSearch service in `docker-compose.yml`** despite being a first-class dependency. **[tracked]**
- **`.env.example` omits all `MEILISEARCH_*`/`SEARCH_*` vars** the code defines (defaults exist, but the prod-required master key is undiscoverable). **[tracked]**
- **`MEILISEARCH_PORT` default is 7700 but the deploy uses 30770.** **[tracked]**
- No `.nvmrc` (Node pinned only as `>=20`, unenforced).

---

## 7. Cross-Cutting Themes

1. **Fail-open vs. fail-closed identity.** The single most important theme. Owner-scoping is *implemented well* everywhere, but its safety rests on the invariant "no id ⇒ trusted system." That invariant is inverted from safe defaults (S-2/S-3), and it silently weakens two other features (search fail-open, facet enumeration P-6). Fixing the principal model at the root neutralizes several findings at once.

2. **"Verified" is asserted before it's true.** The dedup disclosure (S-1) and premature-AVAILABLE (S-4) share a root: the system treats declared-but-unverified metadata (a client-supplied hash, a not-yet-scanned upload) as trusted. A single "content is trusted only after verification, and only for its owner" rule closes both.

3. **Graceful-degradation intent vs. reality.** The code *intends* to degrade gracefully (503 on search outage, best-effort index ensure, retry/backoff) — but the engine-error-wrapping gap (S-5) means the read path doesn't actually degrade, and the queue template (P-3) doesn't actually retry. The intent is right; the wiring has holes.

4. **Excellent unit discipline, thin integration/delivery net.** Where tests exist they are behavior-focused and security-aware; but the highest-risk async paths are untested, there's no CI, and one e2e is broken. The quality ceiling is high; the floor needs raising.

---

## 8. Recommendations — Prioritized Roadmap

**Before any exposure (security-blocking):**
1. Fix **S-1** (owner-scope dedup) — genuine cross-tenant leak, independent of auth.
2. Implement a real **AuthGuard** and make missing identity fail *closed* (**S-2**); redesign the principal sentinel (**S-3**).
3. Wrap engine errors so the 503 path works and internals don't leak (**S-5**).
4. Gate downloads + dedup on verification; add a `PROCESSING` state (**S-4**).

**Before production:**
5. HTTP hardening — helmet + CORS + throttler (**P-1**); enable Postgres TLS verification (**P-2**); prod guards for DB/Redis creds (**P-4**).
6. Queue `defaultJobOptions` + `failed`→Sentry/DLQ (**P-3**); wire the reconciliation scheduler + fix the lifecycle prefix (**D-7**).
7. Health: split liveness/readiness, add timeouts, redact error messages (**P-5**).
8. Facet allowlist (**P-6**); registry-check all indexing jobs + non-destructive reindex (**D-9**); validate the file job payload (**D-6**).

**Data-layer correctness:**
9. Make the base repo honor soft-delete + add transaction support (**D-1, D-2**); unique `(bucket, object_key)` (**D-3**); close the Keyv store on shutdown (**D-4**); cap `putFromStream` size (**D-5**).

**Delivery / quality:**
10. **Add CI** (lint + typecheck + build + unit; e2e gated on service availability) (**T-1, T-5**).
11. Test the file-processing pipeline (**T-2**); fix or exclude `app.e2e-spec.ts` (**T-3**).
12. `strict: true`, tighten ESLint severities + `--max-warnings 0`, add coverage thresholds (**T-4**).

**Housekeeping (tracked):** add MeiliSearch to docker-compose; complete `.env.example`; align `MEILISEARCH_PORT` default; delete/annotate the dead `sentryConfig`; add `Sentry.close()` flush; use `app.port` in `main.ts`.

---

## 9. Tracked vs. New

The following were **already known** and logged in `current_goal` (credit where due — these are triaged, not missed): facet-vs-allowlist alignment (P-6), missing-`x-user-id`→system-principal (part of S-2), `MEILISEARCH_PORT` default drift, MeiliSearch absent from docker-compose, and the 6 `.env.example` tuning vars.

The **new, highest-value** findings this review adds: the cross-tenant dedup disclosure (**S-1**), premature/never verification (**S-4**), the dead 503 path from unwrapped engine errors (**S-5**), the fail-open *direction* of the principal model (**S-3**), and the production-hardening + data-layer set (**P-1–P-5, D-1–D-9**), plus the delivery gaps (**T-1–T-5**).

---

## Appendix A — Unit Test Coverage Map

**Tested (9):** `env.validation`, `file.service`, `file.util`, `index-registry`, `search-indexing.processor`, `search-reconciliation.scheduler`, `search.service` (strongest — incl. injection containment), `meili.health`, `search-engine.service`.

**Untested with real logic (gaps that matter):** `file-processing.processor` (security-critical), `file-reconciliation.scheduler`, `file.repository`, `base.repository`, `object-storage.service`, `zod-validation.pipe` (boundary), `file.controller` (ttl parsing), `database`/`redis`/`minio` health, 6 config factories, 4 DTO schemas, `session-cache.service`, the three provider factories.

**Reasonably untested (declarative):** thin controllers, `*.module.ts`, `main.ts`/`instrument.ts`, schema/seeders/constants/types/interfaces/decorators.

## Appendix B — Files Read Firsthand (verification basis)

`app.module.ts`, `main.ts`, `instrument.ts`, `env.validation.ts`, `zod-validation.pipe.ts`, `current-user.decorator.ts`, `principal.ts`, `base.repository.ts`, `database.module.ts`, `queue.module.ts`, `redis.provider.ts`, `search-engine.service.ts`, `search.service.ts`, `file.service.ts`, `file.repository.ts`, `file.controller.ts`, `search.controller.ts`, `file.schema.ts`, `common.ts` + all config/build files and a targeted grep sweep (guards, filters, CORS, controllers, git-tracked secrets).
