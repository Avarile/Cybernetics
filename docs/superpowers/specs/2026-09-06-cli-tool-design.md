# Cybernetics CLI — Design

**Date:** 2026-09-06
**Status:** Approved for planning

A command-line client for the Cybernetics API, built with `nest-commander`, that
lets a terminal-resident user query, create and update contacts, finances,
projects and knowledge — using vim/nvim as the editor for anything longer than a
flag.

## 1. Goals and non-goals

**Goals**

- Log in once; stay logged in across invocations and across shells.
- Read and write the four core domains: contacts, finance, projects/tasks,
  knowledge.
- Compose substantial records in `$EDITOR` rather than through flags.
- Address records the way a human names them (`CYB-42`, a slug, an email
  address), never by UUID.
- Script cleanly: machine-readable output, meaningful exit codes.

**Non-goals**

- `cyb schedule` — dropped. There is no calendar or events table; `agent_schedule`
  is admin-only Mastra cron and is out of scope. Revisit separately.
- Any change to `api/`. The CLI consumes endpoints that exist today.
- Mailbox, files, search, notifications, system administration and agent chat.
  Not excluded on principle — just not in the first cut.

## 2. Constraints discovered in the codebase

These shaped the design and are the reason several obvious approaches were
rejected.

| Fact | Source | Consequence |
|---|---|---|
| Bearer-only transport, `credentials: false` | `api/src/main.ts` | No cookie jar. Tokens are the whole session. |
| Refresh tokens rotate; reuse revokes the family | `api/src/features/auth/auth.service.ts` | Concurrent refreshes log the user out. Needs a cross-process lock. |
| Only `AUTH_TOKEN_EXPIRED` is refreshable | `client/lib/api/errors.ts:49` | `AUTH_TOKEN_INVALID` / `AUTH_TOKEN_REUSE` mean the session is gone. |
| `/auth/login` throttled 5/min | `auth.controller.ts` | Do not auto-retry a rejected password. |
| Validation errors carry `ZodIssue[]` | `zod-validation.pipe.ts`, `exception.service.ts:26` | Server rejections can be mapped back to buffer lines. |
| DTOs are Zod, exposed via OpenAPI | `nestjs-zod`, `openapi.setup.ts` | JSON Schema is derivable; `.refine()` rules are not. |
| `projects.key` unique; `tasks.number` unique per project | `project.schema.ts` | `CYB-42` is a valid global address. |
| `knowledge.slug` unique | `knowledge.schema.ts` | Slugs are addresses. |
| `knowledge.body` is `text` up to 2 MB, markdown | `knowledge.schema.ts` | The editor path is the primary path, not a nicety. |
| `api/` and `client/` are independent pnpm projects | no root `package.json` | `cli/` is a third peer, not a workspace member. |
| No date-range filter on any list DTO | `listTasksSchema` et al. | An agenda view is not currently expressible. Out of scope with `schedule`. |

## 3. Decisions

Each was chosen over named alternatives; the rejected ones are recorded so they
are not silently relitigated.

### 3.1 Transport: HTTP client

The CLI is a separate package that talks to the API over HTTP with Bearer
tokens, exactly as the web client does.

*Rejected: in-process Nest context.* It would need Postgres, Redis, MinIO and
Meilisearch credentials on the client machine, and would bypass the guard
pipeline that `assertEveryRouteDeclaresPolicy` exists to enforce — creating a
second, unguarded access path to the same data. *Rejected: hybrid.* Two
execution paths per command, both needing tests, for ops work not yet asked for.

### 3.2 Contracts: generated from OpenAPI

`pnpm codegen` fetches `/openapi.json` from a running API and emits typed
operations and JSON Schemas into `cli/src/generated/`, which is **committed**.

*Rejected: importing `api/src` Zod schemas via tsconfig paths.* Tighter fidelity,
but couples the CLI build to a relative path into another package and pins two
copies of `zod`. *Rejected: extracting a shared contracts package.* Correct
long-term, but a ~15-module repo restructure wearing a CLI project's clothes.
*Rejected: hand-written contracts.* Drifts silently — the exact failure the
other options buy their way out of.

**Accepted cost.** Zod's cross-field `.refine()` rules do not survive the JSON
Schema round-trip. `createContactSchema`'s *"Provide a name or an email address"*
and `updateContactSchema`'s *"At least one field must be provided"* cannot be
checked locally; they arrive as a 400. Section 7's retry loop is the mitigation.

### 3.3 Session store: 0600 file

`~/.config/cybernetics/`, honouring `$XDG_CONFIG_HOME`.

*Rejected: OS keychain.* A native dependency that degrades over SSH and in
containers, and whose writes cannot be locked — so the side-car lock file would
be needed anyway. *Rejected: keychain with file fallback.* Two backends, two test
suites, and a fallback that fires silently. *Rejected: service API key only.* No
rotation hazard at all, but the caller becomes `kind: 'service'` — a different
principal, with no session row, for which owner-scoped rows resolve against a
different subject.

### 3.4 Editor buffer: YAML frontmatter + markdown body

A `.md` buffer opened at `filetype=markdown`, so existing highlighting, folding
and spellcheck apply.

*Rejected: pure YAML.* A 2 MB body inside an indentation-sensitive block scalar
is hostile to edit, and one stray dedent truncates it silently. *Rejected: JSON.*
No comments, so schema constraints cannot ride along in the buffer.
*Rejected: flags only.* Does not meet the stated goal.

## 4. Package layout

```
cli/
  package.json            bin: { cyb: "dist/cyb.js" }
  tsconfig.json
  src/
    main.ts               CommandFactory.run(AppModule)
    app.module.ts
    core/
      config/             profiles, XDG paths, precedence
      session/            TokenStore · RefreshLock · SessionService
      http/               ApiClient — bearer, refresh, 429 backoff
      errors/             ErrorEnvelope → message + exit code
      editor/             buffer render/parse, $EDITOR spawn, retry loop
      render/             table · json · yaml
      resolve/            CYB-42 / slug / email → uuid
      schema/             JSON Schema → flags, template, local validation
    generated/            committed codegen output
      openapi.json
      operations.ts
      schemas.ts
    commands/
      auth  contacts  projects  tasks  finance  invoices  knowledge  config
  codegen/                dev-time generator
```

### Why nest-commander

Dependency injection gives every command the same `SessionService` instance
rather than a module-level singleton, which is what makes the refresh lock
testable in isolation. Subcommand nesting via `@Command({ subCommands: [...] })`
maps directly onto the domain tree.

**Known cost:** a full Nest DI container boots on every invocation, roughly
100–200 ms before the command runs. Acceptable interactively, noticeable in a
scripted loop, and there is no lazy-loading escape hatch. Mitigation is to keep
the CLI's module graph small — no database, cache or queue modules.

## 5. Codegen pipeline

```
pnpm codegen   GET /openapi.json → generated/{openapi.json,operations.ts,schemas.ts}
pnpm build     tsup → dist/cyb.js          (no server required)
CI             boot api → regenerate → git diff --exit-code src/generated/
```

Committing the output makes a live API a *maintenance* dependency rather than a
*build* dependency, and turns contract drift into a failing build with a readable
diff instead of a runtime surprise.

**Codegen produces contracts, not commands.** Generating command classes from
`operationId` would yield `cyb contact-controller_list`. The command tree is
hand-written for ergonomics; codegen supplies paths, response types and JSON
Schemas, so a renamed field breaks compilation.

Flags are three-tier:

1. **Curated flags** per command (`--status`, `--project`, `--limit`), typed
   against generated schemas.
2. **`--set key=value`** for any other field, validated at runtime against the
   generated JSON Schema.
3. **`--edit`** for the full buffer.

## 6. Session and authentication

### 6.1 Files

```
$XDG_CONFIG_HOME/cybernetics/        (default ~/.config/cybernetics)
  config.json       0644   { currentProfile, profiles: { dev: { baseUrl, email } }, editor, output }
  credentials.json  0600   { dev: { accessToken, refreshToken, expiresAt } }
  refresh.lock      0600   held only during rotation
```

Precedence: **flags → env → config file**. Environment variables are
`CYB_PROFILE`, `CYB_API_URL` and `CYB_TOKEN`; the last lets CI supply a service
token with no credentials file present.

The CLI **refuses to read `credentials.json` if its mode is not 0600**, the way
`ssh` refuses a world-readable private key.

### 6.2 Login

`cyb login [--profile NAME] [--api URL]` prompts for email (defaulting to the
profile's) and a hidden password, calls `POST /auth/login`, and stores the pair
with `expiresAt = now + expiresIn·1000 − skew`.

A rejected password is **not** retried automatically: the endpoint allows five
attempts per minute, and burning that budget locks the user out.

### 6.3 Refresh

```
acquire refresh.lock (O_EXCL; stale locks reaped via pid liveness + mtime)
  ├─ contended → poll until released, max 10s, then …
  └─ RE-READ credentials.json
       ├─ another process already rotated → adopt its token, release, done
       └─ still expired → POST /auth/refresh
                        → write temp + rename (atomic) → release
```

A waiter that times out after 10s fails with exit 3 rather than refreshing anyway:
an unbounded wait hangs the shell, and refreshing past the timeout is precisely the
double-refresh the lock exists to prevent.

The re-read is load-bearing. Without it every waiter replays the token it queued
with, `auth.service.ts` reads the second use as theft, and the entire session
family is revoked. This is the single most important invariant in the design.

### 6.4 Mid-request 401

Mirroring `client/lib/api/errors.ts`:

| Code | Action |
|---|---|
| `AUTH_TOKEN_EXPIRED` | refresh once under the lock, retry the request exactly once |
| `AUTH_TOKEN_INVALID` | clear credentials, exit 3, instruct `cyb login` |
| `AUTH_TOKEN_REUSE` | clear credentials, exit 3, instruct `cyb login` |

Exactly one retry. A second 401 means the fresh token is being rejected too, and
retrying again would loop.

### 6.5 Throttling

A 429 is retried honouring `Retry-After`. Bulk operations (`--all` page walks)
carry a concurrency cap of 1 and pace themselves. No sliding-window accounting —
one-shot commands do not approach the global budget.

## 7. Editor round-trip

```
cyb knowledge edit auth-token-rotation
  GET → render buffer → spawn editor → parse → diff → PATCH changed keys only
```

- Editor resolution: `$VISUAL` → `$EDITOR` → `vi`, spawned through `sh -c` as git
  does, so `EDITOR="nvim -c 'set spell'"` works.
- Temp file created at 0600 under `$TMPDIR`, removed on exit.
- **`:cq`** (non-zero exit) aborts; nothing is sent.
- **Unchanged content** (hash compare) aborts with "no changes".
- **`400 VALIDATION_FAILED`** re-opens the buffer with each `ZodIssue` rendered as
  a comment above its `path[]` key, preserving the user's edits. Loops until
  valid or aborted.

```yaml
# ✗ slug: must be lowercase-with-dashes
slug: Auth_Token_Rotation
```

### 7.1 Buffer shape

Frontmatter carries the structured fields; the body maps to one designated
long-text field per domain.

| Domain | Body field | Filetype |
|---|---|---|
| knowledge | `body` (2 MB, markdown) | markdown |
| contacts | `notes` (20 k) | markdown |
| tasks, projects | `description` | markdown |
| invoices | `notes` (20 k) | markdown |
| transactions, payments, everything else | — | yaml |

On `add`, required fields are present and uncommented; optional fields are
commented out with their constraints, so the buffer doubles as schema
documentation. Field comments are generated from the JSON Schema — enums,
`maxLength`, `format` and defaults all survive the OpenAPI round-trip.

### 7.2 When the editor opens

`edit` always opens it — that is what the verb means. `add` opens it only when no
field flags were supplied, mirroring `git commit` versus `git commit -m`.
`--edit` forces it; `--no-edit` suppresses it and requires the flags to be
sufficient.

## 8. Human-readable addressing

No command requires a UUID.

| Input | Resolution |
|---|---|
| `CYB-42` | `projects.key` → project id → match `tasks.number` |
| `auth-token-rotation` | `knowledge.slug` (unique) |
| `dana@example.com` | contact search on `primaryEmail` |
| `"Dana Okafor"` | contact search; ambiguity prints candidates and exits 2 |
| a UUID | passed through unchanged |

Resolution is never cached — a stale id is worse than a second request.

**Known inefficiency.** `listTasksSchema` exposes no `number` filter, so resolving
`CYB-42` pages the project's tasks and matches client-side: ten requests for a
500-task project. This is the one place the no-backend-changes constraint costs
something. Adding `number` to `listTasksSchema` would be a one-line fix if it
becomes painful.

## 9. Command tree

```
cyb login | logout | whoami | sessions | passwd
cyb config  profile add|use|ls

cyb contacts   ls | get | add | edit | rm | channel add|rm | rel | log
cyb projects   ls | get | add | edit | rm | member | milestone | goal
cyb tasks      ls | get | add | edit | mv | rm | time log|ls | dep | watch
cyb finance    accounts | tx ls|add|status|reverse | budgets | recurring
               report summary|forecast|income|spend
cyb invoices   ls | get | add | edit | pay
cyb knowledge  ls | get | add | edit | publish | rm | grant
```

`cyb finance report` maps onto the existing `/finance/reports/{summary,forecast,
income-by-category,spend-by-category}` and `/finance/budgets/at-risk`, so
financial state is computed server-side rather than reassembled from transaction
lists.

## 10. Output and exit codes

Aligned table to a TTY; colour disabled when not a TTY. `--json` emits the raw
response for `jq`; `--yaml` for reading. `--limit` / `--page`, plus `--all` to
walk pages with pacing.

Exit codes derive from `ErrorEnvelope.error.code`:

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | unexpected failure |
| 2 | usage error, validation failure, or ambiguous address |
| 3 | authentication required |
| 4 | not found |
| 5 | forbidden |
| 6 | conflict |

## 11. Testing

| Concern | Approach |
|---|---|
| Buffer round-trip | render → parse → assert identity; diff sends only changed keys |
| Error mapping | `ZodIssue[]` → comment on the correct line |
| Editor spawn | inject a stub `EDITOR` script — headless and deterministic |
| Refresh lock | spawn N real processes against a counting fake server; assert **exactly one** `/auth/refresh` |
| Token expiry | skew arithmetic at boundaries |
| Address resolution | unique hit, ambiguous hit, miss, raw UUID passthrough |
| Contract drift | CI regenerates against a booted API, `git diff --exit-code` |

The refresh-lock test is written first. It guards the only failure mode here
that logs the user out of every session they have.

## 12. Build order

1. Skeleton, config/session/http core, `login` and `whoami`.
2. Codegen plus the CI drift check.
3. Read paths (`ls`, `get`) across all four domains, plus rendering.
4. Editor round-trip, on `knowledge` first — it is the most body-heavy.
5. Write paths for the remaining domains, plus address resolution.
6. Finance reports.

Phase 1 carries the risk. Everything after it is repetition of an established
pattern.

## 13. Open risks

- **Cross-field rules are invisible locally.** `.refine()` constraints surface as
  a 400 and a re-opened buffer rather than immediate feedback. Accepted cost of
  §3.2; §7 makes it survivable.
- **Login throttling.** Three fat-fingered passwords in a row cost a minute's
  lockout. The CLI must say so rather than appear broken.
- **Nest boot cost.** 100–200 ms per invocation; poor fit for tight scripted
  loops.
- **`CYB-42` resolution cost** grows with project size until `listTasksSchema`
  gains a `number` filter.
