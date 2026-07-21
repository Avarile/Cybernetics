# Design — Scalar API Documentation (`api/`)

**Status:** Approved (design phase). Next step: implementation plan.
**Scope:** Backend only, in `api/`. Adds an auto-generated OpenAPI 3.x contract and an
interactive Scalar reference UI. No behavioral change to existing endpoints; the request
validation and error-response contracts are preserved exactly.

---

## 1. Concept

The API currently ships **no machine-readable contract and no interactive docs**. There is
no `@nestjs/swagger`, no `@scalar/*`, no `openapi` dependency, and `main.ts` performs no
document setup.

This design adds a **production-grade, auto-generated OpenAPI 3.x document** rendered as
**Scalar** docs. The defining constraint of the codebase drives the whole approach:

> **Validation is done with Zod, not class-validator.** DTOs are raw Zod schemas plus
> `z.infer` types (`export const refreshSchema = z.object({...})`), wired through a custom
> `ZodValidationPipe(schema)` at each `@Body(...)`.

Because `@nestjs/swagger`'s automatic schema generation relies on class-validator decorators
and TypeScript reflection — which do not exist here — the document is instead generated from
the **existing Zod schemas** via `nestjs-zod`. The same schema that validates a request also
documents it, so **the docs cannot drift from runtime behavior**.

### Decisions locked in brainstorming

| Decision | Choice |
|---|---|
| Audience | Both — internal reference now, structured to become a public portal later |
| Docs access | Fully public in all environments, with an `OPENAPI_ENABLED` env kill-switch |
| Zod → OpenAPI strategy | `nestjs-zod` (`createZodDto`) + `@nestjs/swagger` auto-discovery + Scalar |
| Validation pipe | Global pipe that **preserves the existing `ErrorEnvelope`** (see §6) |

### Surface being documented

| Metric | Count |
|---|---|
| Feature modules | 7 (`auth`, `users`, `search-service`, `file-processor`, `mailbox`, `mastra`, `system`) |
| Controllers | 17 |
| Endpoints | 69 |
| DTO files | 32 |
| `new ZodValidationPipe(...)` call sites | 37 |

---

## 2. Packages

| Package | Version | Role |
|---|---|---|
| `nestjs-zod` | pin **v5.4.0** | `createZodDto`, `createZodValidationPipe`, `cleanupOpenApiDoc()` |
| `@nestjs/swagger` | v11.4.6 (matches Nest 11) | `DocumentBuilder`, `SwaggerModule.createDocument`, route decorators |
| `@scalar/nestjs-api-reference` | v1.2.11 | `apiReference()` middleware — renders the UI |

**Version notes (verified against installed type defs)**

- **Why v5, not v4:** `nestjs-zod` v4's `createZodDto` is typed against `@nest-zod/z` (a
  deprecated Zod *fork*), which would push that fork into a codebase whose 32 DTOs use plain
  `import { z } from 'zod'`. **v5 accepts plain `zod` schemas directly** (peerDep
  `zod: ^3.25.0 || ^4.0.0`, matching the project's `3.25.76`) and replaces the v4
  `patchNestjsSwagger()` scanner-patch with a post-processing step, `cleanupOpenApiDoc(doc)`.
- **Integration flow (v5):** build the document with `SwaggerModule.createDocument(app, config)`,
  then wrap it once: `const doc = cleanupOpenApiDoc(created)`. `cleanupOpenApiDoc` only touches
  schemas generated from `createZodDto` DTOs. No pre-build patch step is needed.
- **Global pipe is safe:** `createZodValidationPipe({ createValidationException })` returns a pipe
  whose `transform` passes through any param whose metatype is **not** a `createZodDto` class
  (verified: `strictSchemaDeclaration` defaults to `false`), so `@Param('id') id: string`,
  `@Req()`, etc. are untouched; only DTO params are validated — through our custom exception.
- We do **not** install the `@nestjs/swagger` CLI/TS plugin (that plugin infers schemas from
  class-validator types). Schema generation comes entirely from `createZodDto`, so the
  existing **SWC-based build stays untouched**.
- `@scalar/nestjs-api-reference` is mounted as Express middleware (`app.use(...)`). The app
  uses `@nestjs/platform-express`, so no `withFastify` option is needed.

---

## 3. Module layout (new, isolated)

A single new infrastructure module owns all OpenAPI concerns:

```
api/src/infrastructure/openapi/
  openapi.constants.ts   # tag names, bearer security-scheme name, route paths
  openapi.config.ts      # buildDocumentConfig(): DocumentBuilder (title, version, servers, tags, addBearerAuth)
  openapi.postprocess.ts # applyGlobalSecurity(), markPublicRoutes(), registerErrorComponents()
  openapi.setup.ts       # setupOpenApi(app): patch → build → post-process → serve
  decorators/
    api-standard-errors.decorator.ts  # @ApiStandardErrors() composite
  openapi.setup.spec.ts
```

**Boundaries**

- `setupOpenApi(app)` is the **only** exported entry point; `main.ts` calls it once, after
  guards/pipes are registered and before `app.listen()`.
- The module depends only on the Nest `INestApplication`, `ConfigService`, and the app's
  existing exception/`@Public()` primitives. It introduces no coupling back into feature
  modules.

### `main.ts` wiring

```ts
// after app.enableCors(...) and before app.listen(port)
await setupOpenApi(app);
```

### Config additions (`api/src/config`)

Add to the Zod env schema:

| Var | Type | Default | Purpose |
|---|---|---|---|
| `OPENAPI_ENABLED` | boolean (coerced) | `true` | Kill-switch; when `false`, neither route is mounted |
| `OPENAPI_SERVER_URL` | string (url, optional) | request host | Populates the OpenAPI `servers` block (e.g. `https://api.example.com`) |

Both are added to `.env.example`.

---

## 4. DTO migration → single source of truth

Every DTO file keeps its **schema** export and **replaces** its inferred-type export with a
`createZodDto` class of the same canonical name:

```ts
// api/src/features/auth/dto/refresh.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const refreshSchema = z.object({ refreshToken: z.string().min(1) });
export class RefreshDto extends createZodDto(refreshSchema) {}   // replaces `type RefreshDto`
```

**Naming convention (explicit, applied to all 32 files):** the `createZodDto` class takes the
**canonical DTO name** (`RefreshDto`), replacing the previous `export type RefreshDto = z.infer<...>`.
This is chosen because a TypeScript class is **both a value and a type** with the same inferred
shape, so existing type-position usages (`function login(dto: RefreshDto)`) keep compiling
unchanged, while the class also serves as the runtime metatype the pipe and swagger need. The
`schema` export is retained for any code that references it directly. The class carries a static
`.schema` and is detected by `nestjs-zod`'s `isZodDto()`.

One caveat handled during migration: call sites that imported the DTO as `import type { RefreshDto }`
and use it **only** in type position stay valid; the `@Body(new ZodValidationPipe(schema))`
sites are the ones that change (see §6).

**Query/param DTOs:** schemas that use `z.coerce` (e.g. `search-query.dto.ts`) render as
query parameters via `@ApiQuery`/`createZodDto` and continue to coerce at runtime unchanged.

---

## 5. Endpoint discovery & metadata (progressive, non-blocking)

- `@nestjs/swagger` auto-discovers all 69 routes from the existing `@Get/@Post/...`
  decorators — **the document is complete from day one**, even before prose is added.
- Metadata is layered in incrementally:
  - `@ApiTags('<feature>')` per controller → 7 logical groups.
  - `@ApiOperation({ summary })` per endpoint.
  - `@ApiResponse` / `@ApiOkResponse` referencing DTO classes for success bodies.
  - Request examples where they add clarity.
- **Public-readiness bar** (enforced later by a test, see §9): every operation has a tag, a
  summary, and a documented success response.

---

## 6. Validation pipe strategy — preserve the error envelope

**Constraint:** today, 37 sites do `@Body(new ZodValidationPipe(schema))`, and on failure the
custom pipe throws `AppException(ErrorCode.VALIDATION_FAILED, { details: { issues } })`, which
the `GlobalExceptionFilter` renders into the single public `ErrorEnvelope`:

```json
{ "error": { "code", "message", "statusCode", "details", "correlationId", "timestamp", "path" } }
```

`nestjs-zod`'s default `ZodValidationPipe` throws its own `ZodValidationException`, which would
**bypass this envelope**. We prevent that.

**Chosen approach (a): a global, envelope-preserving pipe.**

Use `nestjs-zod`'s factory to inject the app's exception:

```ts
// api/src/common/pipes/zod-validation.pipe.ts  (extended)
import { createZodValidationPipe } from 'nestjs-zod';
import { ZodError } from 'zod';
import { AppException, ErrorCode } from '../../infrastructure/exceptions';

export const ZodValidationPipe = createZodValidationPipe({
  createValidationException: (error: ZodError) =>
    new AppException(ErrorCode.VALIDATION_FAILED, {
      details: {
        issues: error.issues.map((i) => ({
          path: i.path.join('.') || '(root)',
          message: i.message,
        })),
      },
    }),
});
```

Register it globally:

```ts
// app.module.ts providers
{ provide: APP_PIPE, useClass: ZodValidationPipe },
```

**Effects**

- The global pipe auto-validates any handler param whose metatype is a `createZodDto` class
  (detected via `isZodDto`), so the 37 `@Body(new ZodValidationPipe(schema))` sites become
  plain `@Body() body: RefreshDto` — boilerplate removed.
- The **exact same `ErrorEnvelope`** is produced, because validation failures still throw the
  app's `AppException(VALIDATION_FAILED)` with the identical `details.issues` shape.
- The existing custom pipe's per-issue mapping logic is preserved verbatim inside
  `createValidationException`, so `zod-validation.pipe.spec.ts` expectations still hold (with
  minor construction-site updates).

**Migration mechanics for the 37 sites:** replace `@Body(new ZodValidationPipe(schema)) body: T`
with `@Body() body: T` (where `T` is now the `createZodDto` class). Params validated from
query/params follow the same pattern with their DTO classes.

---

## 7. Security scheme

- `DocumentBuilder.addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')`
  registers the JWT scheme.
- The scheme is applied as a **global security requirement**, mirroring the globally-registered
  `JwtAuthGuard` (`app.module.ts` → `APP_GUARD`).
- A post-processor (`markPublicRoutes`) reads `@Public()` reflector metadata (the same
  `IS_PUBLIC_KEY` the guard uses) and sets `security: []` on those operations — so `login`,
  `refresh`, `forgot-password`, etc. correctly render as no-auth in Scalar.
- Roles: `RolesGuard`-restricted endpoints get a note in their `@ApiOperation` description
  (e.g. "Admin only"). Full role modeling is out of scope for v1; documented in prose.

---

## 8. Error documentation

- `registerErrorComponents` adds the `ErrorEnvelope` shape as a reusable
  `components.schemas.ErrorEnvelope`, plus the `ErrorCode` enum as an enum schema.
- A composite decorator `@ApiStandardErrors()` attaches the common responses in one line per
  controller/handler:

| Status | Meaning | Body |
|---|---|---|
| 400 | Validation failed (`VALIDATION_FAILED`) | `ErrorEnvelope` |
| 401 | Missing/invalid bearer token | `ErrorEnvelope` |
| 403 | Role not permitted | `ErrorEnvelope` |
| 429 | Throttled (`ThrottlerGuard`) | `ErrorEnvelope` |
| 500 | Internal error (message from registry) | `ErrorEnvelope` |

- The 400 response documents the `details.issues[]` array so consumers can parse field errors.

---

## 9. Data flow

```
Boot: setupOpenApi(app)
  → if !OPENAPI_ENABLED: return (no routes mounted)
  → SwaggerModule.createDocument(app, buildDocumentConfig())
                                         # introspect 17 controllers / 69 routes / DTO classes
  → cleanupOpenApiDoc(created)           # convert createZodDto schemas → correct OpenAPI
  → applyGlobalSecurity(doc)             # global bearer requirement
  → markPublicRoutes(app, doc)           # @Public() → security: []
  → registerErrorComponents(doc)         # ErrorEnvelope + ErrorCode
  → GET /openapi.json  serves the document
  → app.use('/reference', apiReference({ content: doc, theme: 'default' }))

Runtime:
  browser → GET /reference → Scalar UI → fetches /openapi.json → renders
  "Try it" request → hits the real guard/pipe/controller stack (no bypass)
```

Both `/reference` and `/openapi.json` are marked `@Public()`-equivalent (mounted as raw
middleware outside the guard chain / explicitly public), so the global `JwtAuthGuard` does not
block them.

---

## 10. Testing

Respects the project rule that e2e specs **boot module subsets, not `AppModule`** (Mastra's
ESM dependency breaks Jest when the full graph loads).

**e2e**
- `GET /openapi.json` → 200; body is a valid OpenAPI 3 document with `paths`,
  `components.securitySchemes.bearer`, and `components.schemas.ErrorEnvelope`.
- `GET /reference` → 200 HTML.
- Kill-switch: with `OPENAPI_ENABLED=false`, both routes → 404.

**Unit**
- A `createZodDto` class validates identically to its raw schema (accept + reject cases).
- The global `ZodValidationPipe` still emits the exact `ErrorEnvelope` `details.issues[]` on
  invalid input (extends the existing `zod-validation.pipe.spec.ts`).
- `markPublicRoutes` sets `security: []` for a `@Public()` route and leaves it set for a
  guarded route.

**Drift guard (recommended for public-readiness)**
- A test iterating the generated document asserting every operation has a tag + summary +
  documented success response; fails CI when an undocumented endpoint is added.

---

## 11. Rollout — 4 independently shippable phases

1. **Serve** — install packages; add `openapi` module, `main.ts` wiring, env flag +
   `.env.example`; serve `/openapi.json` + Scalar at `/reference`. Docs live and
   auto-discovered with minimal metadata.
2. **Schemas** — migrate 32 DTOs to `createZodDto`; switch to the global envelope-preserving
   pipe (§6); remove the 37 manual pipe sites. Request/response schemas now render.
3. **Contract** — global bearer security scheme + `@Public()` overrides + `ErrorEnvelope`
   components + `@ApiStandardErrors()`.
4. **Polish** — per-endpoint tags/summaries/examples + drift-guard test.

Each phase leaves the app in a working, committable state.

---

## 12. Out of scope (v1)

- Full RBAC/role modeling in the OpenAPI security requirements (documented in prose instead).
- Basic-auth / env-gated access control for docs (explicitly declined — docs are fully public).
- API versioning (`/v1`) and multi-version documents — the structure supports it later.
- SDK/client generation from the document (the JSON at `/openapi.json` enables it downstream).
