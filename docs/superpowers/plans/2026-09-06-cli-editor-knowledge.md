# Cybernetics CLI — Editor + Knowledge Implementation Plan (Stage 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Compose and revise records in `$EDITOR` — YAML frontmatter plus a markdown body — with server validation errors fed back into the buffer, and address records by human names instead of UUIDs. Delivered end-to-end on the `knowledge` domain.

**Architecture:** Four small editor modules (document format, template generation, issue annotation, process orchestration) plus an address resolver, composed by the `knowledge` command group. Buffer templates are generated from the committed OpenAPI JSON Schemas, so field constraints appear as comments in the buffer.

**Tech Stack:** Same as Stage 1 — TypeScript (CommonJS), nest-commander, jest + @swc/jest, `yaml`, `ajv`.

**Spec:** `docs/superpowers/specs/2026-09-06-cli-tool-design.md` (sections 7, 8, and the rendering half of 10)
**Preceding plan:** `docs/superpowers/plans/2026-09-06-cli-foundation.md` (complete)

## Global Constraints

- **DO NOT COMMIT, STAGE, OR REWRITE HISTORY.** Another agent commits to this branch from a shared index. Leave all work uncommitted. No `git add`, `git commit`, `git stash`, rebase, reset, or amend.
- Node `>=20`, global `fetch` (no `node-fetch`), CommonJS, no `"type": "module"`.
- Test files are `*.spec.ts` colocated beside their source.
- Exit codes: `0` ok · `1` unexpected · `2` usage/validation/ambiguous · `3` auth required · `4` not found · `5` forbidden · `6` conflict.
- Editor buffers are written to `$TMPDIR` at mode `0600` and removed on exit — they contain record data.
- Editor resolution order is `$VISUAL` → `$EDITOR` → `vi`, spawned through `sh -c` so an editor string carrying flags (`EDITOR="nvim -c 'set spell'"`) works, as git does it.
- A non-zero editor exit (`:cq`) aborts and sends nothing. Unchanged content aborts and sends nothing.
- `PATCH` requests send **only changed fields**, never the whole record.
- Knowledge updates send `expectedVersion` from the fetched record so a concurrent edit yields `409` (exit 6) rather than silently clobbering.
- Do not modify anything under `src/core/session/`, `src/core/http/`, `src/codegen/`, or `src/generated/`.

## Existing interfaces (Stage 1, all tested)

- `ApiClient` — `get/post/patch/del<T>(path, body?, init?)`
- `ApiError` — `.status`, `.code`, `.issues: ApiIssue[]` (`{path: (string|number)[], message: string}`), `.exitCode`; `UsageError`; `ExitCode`; `reportError`
- `SettingsService.resolve({profile?, api?})` → `{profile, baseUrl, email?}`
- `ClientFactory.create(settings)` → `ApiClient`
- `renderTable(rows, columns)` — aligned plain-text table (built during the Stage 1 sessions fix)
- `schemas` from `src/generated/schemas.ts` — JSON Schema per DTO name
- `operations` from `src/generated/operations.ts` — `{method, path, pathParams, queryParams, requestSchema, isPublic}` per operationId

## File Structure

| File | Responsibility |
|---|---|
| `src/core/editor/frontmatter.ts` | parse/render the YAML-frontmatter-plus-body document format |
| `src/core/editor/template.ts` | JSON Schema + current record → annotated buffer text |
| `src/core/editor/issues.ts` | render `ApiIssue[]` as comments above their fields |
| `src/core/editor/editor.service.ts` | spawn the editor, detect abort/no-change, diff, drive the retry loop |
| `src/core/resolve/resolver.ts` | human address → UUID |
| `src/commands/knowledge/*.command.ts` | the `cyb knowledge` group |

## Task Dependency Graph

```
1 (frontmatter) ──┬── 2 (template) ──┐
                  ├── 3 (issues) ────┼── 4 (EditorService) ──┐
                                                             ├── 6 (knowledge cmds)
                  5 (resolver) ──────────────────────────────┘
```

---

### Task 1: Document format — YAML frontmatter plus body

**Files:** Create `src/core/editor/frontmatter.ts`, `src/core/editor/frontmatter.spec.ts`

**Interfaces produced:**
```ts
export interface EditorDocument {
  /** Structured fields from the YAML frontmatter block. */
  fields: Record<string, unknown>;
  /** Free text after the closing `---`. Empty string when the doc has no body. */
  body: string;
}
export function renderDocument(doc: EditorDocument, header?: string[]): string;
export function parseDocument(text: string): EditorDocument;
export class DocumentParseError extends Error {}
```

**Behaviour contract:**
- `renderDocument` emits optional `#` header comment lines, then `---`, the YAML for `fields`, `---`, a blank line, then `body`.
- `parseDocument` requires the first non-blank, non-comment line to be `---`; anything else is a `DocumentParseError` naming what was expected.
- Leading `#` comment lines before the opening `---` are ignored.
- Comments *inside* the frontmatter are dropped on parse (they are generated guidance, not data).
- A document with no closing `---` is a `DocumentParseError`.
- A document with no body section yields `body: ''`.
- Body content is preserved byte-for-byte apart from a single trailing newline.
- Round-trip: `parseDocument(renderDocument(d))` deep-equals `d` for any `d` whose fields are YAML-representable scalars, arrays and nested objects.

- [ ] **Step 1: Write the failing spec** covering: round-trip with scalars/arrays/nested objects; header comments ignored; frontmatter comments dropped; missing opening `---`; missing closing `---`; empty body; body containing `---` on its own line (must NOT terminate the body); multi-paragraph body preserved exactly; a body containing YAML-looking text left untouched.
- [ ] **Step 2: Run it, confirm failure** — `cd cli && pnpm jest src/core/editor/frontmatter.spec.ts`, expect `Cannot find module`.
- [ ] **Step 3: Implement** using the `yaml` package for the frontmatter block only. Split on the first two `---` delimiter lines; never YAML-parse the body.
- [ ] **Step 4: Run it, confirm pass.**
- [ ] **Step 5: Run the full suite** — `pnpm test`, no regressions.

---

### Task 2: Buffer template from JSON Schema

**Files:** Create `src/core/editor/template.ts`, `src/core/editor/template.spec.ts`

**Interfaces produced:**
```ts
export interface TemplateOptions {
  /** JSON Schema for the request DTO, from `src/generated/schemas.ts`. */
  schema: unknown;
  /** Existing record for an edit; omit/null for a create. */
  current?: Record<string, unknown> | null;
  /** Field whose value becomes the markdown body (e.g. 'body' for knowledge). */
  bodyField?: string;
  /** Header comment lines placed above the frontmatter. */
  header?: string[];
}
export function buildTemplate(opts: TemplateOptions): string;
/** Fields the template rendered, so the diff step knows what the user could change. */
export function templateFields(schema: unknown, bodyField?: string): string[];
```

**Behaviour contract:**
- Each frontmatter key carries a trailing `#` comment derived from its schema: `enum` values joined by `|`; `maxLength` as `max N`; `format` (`date-time`, `uuid`, `email`) verbatim; `default` as `default X`. Multiple facts are comma-separated. No comment when the schema offers none.
- On a **create** (`current` absent): required fields are present and uncommented with their default or an empty value; optional fields are emitted **commented out** so the buffer doubles as documentation.
- On an **edit** (`current` present): every field the schema accepts is present and uncommented, populated from `current`; fields absent from `current` render as empty.
- When `bodyField` is set, that field is excluded from the frontmatter and its value becomes the document body.
- `date-time` values render as `YYYY-MM-DD` when the time is midnight UTC, else full ISO — round-tripping either is acceptable to the API's `z.coerce.date()`.
- Read-only server fields never appear: the schema is the request DTO, so `id`, `createdAt`, `version` and `viewCount` are absent by construction. Do not add them.

- [ ] **Step 1: Write the failing spec** against a small hand-written schema fixture (do NOT depend on the real generated file — it changes) covering: enum comment; maxLength comment; combined comments; required-uncommented/optional-commented on create; all-uncommented on edit; body extraction; date-only rendering; a field with no schema facts gets no comment; `templateFields` returns exactly the frontmatter keys plus the body field.
- [ ] **Step 2: Run it, confirm failure.**
- [ ] **Step 3: Implement.** Read `required` from the schema; treat everything in `properties` as a candidate field.
- [ ] **Step 4: Run it, confirm pass.**
- [ ] **Step 5: Sanity-check against reality** — in a scratch script (delete it afterwards), call `buildTemplate` with `schemas['CreateKnowledgeDto']` and print the result. Confirm `title`, `slug`, `status`, `visibility`, `language` appear with sensible comments and that `body` is absent from the frontmatter when `bodyField: 'body'`. Paste the output in your report.
- [ ] **Step 6: Run the full suite.**

---

### Task 3: Validation-issue annotation

**Files:** Create `src/core/editor/issues.ts`, `src/core/editor/issues.spec.ts`

**Interfaces produced:**
```ts
export function annotate(bufferText: string, issues: ApiIssue[]): string;
```

**Behaviour contract:**
- For each issue, insert `# ✗ <path>: <message>` on the line immediately above the frontmatter key matching `issues[i].path[0]`, preserving the key's own indentation.
- `path` deeper than one segment renders dotted (`tagIds.0`) in the comment but still anchors on the first segment's key.
- An issue whose field is not present in the buffer is collected into a block of `# ✗ …` lines directly under the header, so nothing is silently dropped.
- Annotations from a previous round are stripped before new ones are added — the loop must not accumulate stale comments.
- An empty issue list returns the text unchanged.
- Annotation never reorders, reformats, or reindents the user's content.

- [ ] **Step 1: Write the failing spec** covering: single field annotated above the right line; two issues on different fields; a nested path; an unmatched field going to the header block; stale annotations from a prior round removed; empty list is a no-op; indentation preserved for an indented key.
- [ ] **Step 2: Run it, confirm failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it, confirm pass.**
- [ ] **Step 5: Run the full suite.**

---

### Task 4: EditorService

**Files:** Create `src/core/editor/editor.service.ts`, `src/core/editor/editor.service.spec.ts`

**Interfaces produced:**
```ts
export interface EditorDeps {
  /** Injected for tests. Default spawns via `sh -c`. */
  launch?: (command: string, file: string) => Promise<number>;
  env?: NodeJS.ProcessEnv;
}
export interface EditSessionOptions {
  /** Initial buffer text (from buildTemplate). */
  initial: string;
  /** Sends the parsed document; resolve on success, reject with ApiError on failure. */
  submit: (doc: EditorDocument) => Promise<void>;
  /** Filetype hint used for the temp file extension: 'md' or 'yaml'. */
  filetype?: 'md' | 'yaml';
}
export class EditorAborted extends Error {}
export class EditorService {
  constructor(deps?: EditorDeps);
  /** Returns when submit() succeeds. Throws EditorAborted on :cq or no-change. */
  async run(opts: EditSessionOptions): Promise<void>;
  /** Exposed for tests and for `--no-edit` callers. */
  resolveEditor(): string;
}
```

**Behaviour contract:**
- `resolveEditor` returns `$VISUAL`, else `$EDITOR`, else `vi`.
- The temp file is created at `0600` under `$TMPDIR` with the extension implied by `filetype`, and is removed in a `finally` even when the flow throws.
- Default `launch` runs `sh -c '<editor> "$1"' sh <file>` so an editor string with flags works and the filename is never word-split.
- A non-zero editor exit throws `EditorAborted('aborted')`; the buffer is not submitted.
- Text identical to what was written throws `EditorAborted('no changes')`.
- On `submit` rejecting with an `ApiError` carrying `issues`, the buffer is re-annotated via `annotate` and re-opened. The user's edits are preserved; only annotations change.
- On `submit` rejecting with an `ApiError` carrying **no** issues (a 403, 404, 409), the error propagates — re-opening the buffer would not help.
- A `DocumentParseError` from the user's own YAML mistake re-opens the buffer with the parse error as a header annotation rather than discarding their work.
- Maximum 5 rounds; the sixth throws the last error so a pathological loop terminates.

- [ ] **Step 1: Write the failing spec** with an injected `launch` stub that mutates the file. Cover: happy path submits the parsed doc; `:cq` (non-zero exit) aborts without submitting; unchanged text aborts; an `ApiError` with issues re-opens with annotations and succeeds on round two; an `ApiError` without issues propagates immediately; invalid YAML re-opens rather than discarding; the round cap throws; the temp file is deleted on every path including throws.
- [ ] **Step 2: Run it, confirm failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it, confirm pass.**
- [ ] **Step 5: Verify the temp file is 0600** in a test asserting `statSync(...).mode & 0o777`.
- [ ] **Step 6: Run the full suite.**

---

### Task 5: Address resolver

**Files:** Create `src/core/resolve/resolver.ts`, `src/core/resolve/resolver.spec.ts`

**Interfaces produced:**
```ts
export interface ResolveStrategy {
  /** Domain label used in error messages, e.g. 'knowledge'. */
  domain: string;
  /** True when this input looks like something the strategy can resolve. */
  matches: (input: string) => boolean;
  /** Returns candidates; empty means not found. */
  lookup: (input: string, client: ApiClient) => Promise<Array<{ id: string; label: string }>>;
}
export class AddressResolver {
  constructor(client: ApiClient);
  /** UUID passes through untouched. Otherwise runs the strategy. */
  async resolve(input: string, strategy: ResolveStrategy): Promise<string>;
}
export const knowledgeBySlug: ResolveStrategy;
export const contactByEmailOrName: ResolveStrategy;
export const projectByKey: ResolveStrategy;
export const taskByProjectAndNumber: ResolveStrategy; // "CYB-42"
```

**Behaviour contract:**
- A well-formed UUID returns unchanged without any HTTP call.
- Exactly one candidate returns its id.
- Zero candidates throws `UsageError` (exit 2) naming the domain and the input.
- Two or more candidates throws `UsageError` listing every candidate's label and short id, so the user can retry unambiguously. Never guess.
- `taskByProjectAndNumber` parses `KEY-NUMBER` case-insensitively, resolves the project by `key`, then pages `/tasks?projectId=…` matching `number`. **Log a warning to stderr when it pages more than 3 times** — the design notes this is the one inefficient path (`listTasksSchema` has no `number` filter) and silence would hide it growing.
- Resolution results are never cached.

- [ ] **Step 1: Write the failing spec** with a stubbed `ApiClient`. Cover: UUID passthrough with zero HTTP calls; single match; zero matches → UsageError exit 2; multiple matches → UsageError listing candidates; `CYB-42` parsed and resolved; lowercase `cyb-42` accepted; a malformed `CYB-` rejected as a usage error; the >3-page warning fires.
- [ ] **Step 2: Run it, confirm failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it, confirm pass.**
- [ ] **Step 5: Run the full suite.**

---

### Task 6: The `cyb knowledge` command group

**Files:** Create `src/commands/knowledge/knowledge.command.ts` (group + subcommands, split per file if it exceeds ~200 lines), `src/commands/knowledge/knowledge.command.spec.ts`; modify `src/app.module.ts` to register them.

**Endpoints** (from `src/generated/operations.ts`, verified against the live API):

| Command | Operation |
|---|---|
| `ls` | `GET /knowledge` — query `search,status,typeId,categoryId,tagId,page,limit` |
| `get <addr>` | `GET /knowledge/{id}` |
| `add` | `POST /knowledge` — `CreateKnowledgeDto` |
| `edit <addr>` | `PATCH /knowledge/{id}` — `UpdateKnowledgeDto` |
| `publish <addr>` | `POST /knowledge/{id}/status` — `TransitionKnowledgeDto` |
| `rm <addr>` | `DELETE /knowledge/{id}` (204) |

**Behaviour contract:**
- `ls` renders a table via `renderTable`: `STATUS`, `TITLE` (truncated), `SLUG`, `UPDATED`. `--status`, `--search`, `--limit`, `--page` flags; `--json` emits the raw envelope. Withheld rows are announced, never silently dropped.
- `get <addr>` resolves the address via `knowledgeBySlug`, then prints the record as a read-only frontmatter document (same format the editor uses) so `get` and `edit` show the same shape. `--json` for raw.
- `add` opens the editor when no field flags are given; uses flags when they are; `--edit` forces the editor, `--no-edit` forbids it. Body field is `body`, filetype `md`. On success prints the created slug and id.
- `edit <addr>` fetches the record, opens the editor pre-filled, and `PATCH`es **only changed fields**, including `expectedVersion` from the fetched record. A `409` surfaces as exit 6 with a message telling the user the record changed underneath them and to re-run.
- `publish <addr>` posts the status transition; `--status <s>` defaults to `published`.
- `rm <addr>` requires `--yes` or an interactive confirmation; refuses in a non-TTY without `--yes`.
- Every command accepts `-p/--profile` and `--api`.

- [ ] **Step 1: Write the failing spec** with stubbed `ApiClient`, `EditorService` and resolver. Cover: `ls` renders a table and passes filters through; `ls --json` is raw; `get` resolves a slug and renders a document; `add` with flags skips the editor; `add` with no flags opens it; `edit` sends only changed fields; `edit` includes `expectedVersion`; a 409 exits 6; `rm` without `--yes` in a non-TTY refuses; `rm --yes` deletes.
- [ ] **Step 2: Run it, confirm failure.**
- [ ] **Step 3: Implement the commands.**
- [ ] **Step 4: Register in `app.module.ts`** and run it, confirm pass.
- [ ] **Step 5: Build and smoke-test live.** The API runs on `:3000` and `~/.config/cybernetics` holds a valid admin session — **use it read-only, do not delete or overwrite it.** Run and paste real output for: `cyb knowledge ls`, `cyb knowledge ls --json | head`, `cyb knowledge --help`. If knowledge records exist, also `cyb knowledge get <slug>`. Do NOT run `add`/`edit`/`rm` against live data unless you create and then remove your own record, and say clearly which you did.
- [ ] **Step 6: Run the full suite and typecheck.**

---

## Done Criteria

- `cyb knowledge ls` renders an aligned table against the live API.
- `cyb knowledge add` opens `$EDITOR` with a schema-derived template; `:cq` aborts; saving creates a record.
- `cyb knowledge edit <slug>` round-trips, sends only changed fields, and exits 6 on a concurrent edit.
- A server validation error re-opens the buffer with `# ✗ field: message` above the offending key, preserving edits.
- `cyb knowledge get CYB-does-not-exist` exits 2 naming the domain; an ambiguous name lists candidates.
- Full suite green, typecheck clean, everything uncommitted.
