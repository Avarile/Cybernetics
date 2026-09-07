# Cybernetics CLI — Vocabulary and Key-Backed Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make classification usable — list and manage every vocabulary from the CLI, and let editor buffers carry human keys instead of UUIDs.

**Architecture:** One new core module holding the vocabulary index and its lookup strategies, plus a single declarative map of which buffer fields are key-backed. Four new command groups follow the six that already exist. `template.ts` learns to render key-backed fields; `add`/`edit` commands map them back before submit.

**Spec:** `docs/superpowers/specs/2026-09-07-cli-vocabulary-design.md`
**Preceding plans:** `2026-09-06-cli-foundation.md`, `2026-09-06-cli-editor-knowledge.md`, `2026-09-06-cli-domains.md` (all complete)

## Global Constraints

- **DO NOT COMMIT, STAGE, OR REWRITE HISTORY.** No `git add`, `git commit`, `git stash`, rebase, reset, amend. Leave work uncommitted. For RED evidence, inline the old implementation into a throwaway spec and delete it.
- Node `>=20`, global `fetch`, CommonJS, no `"type": "module"`. Tests are `*.spec.ts` colocated.
- Exit codes: `0` ok · `1` unexpected · `2` usage/validation/ambiguous · `3` auth required · `4` not found · `5` forbidden · `6` conflict.
- Every list: `renderTable`, `--limit` default 20, `--page`, `--json` raw envelope, withheld rows announced. Every destructive command: `--yes` plus a non-TTY refusal. Every command: `-p/--profile` and `--api`.
- **A negate flag's `@Option` handler must `return false`** — nest-commander routes handlers through commander's `argParser`, so returning `true` makes `--no-edit` behave as `--edit`. Unit tests cannot catch it; verify on the built binary.
- **Confirm every endpoint against `src/generated/operations.ts`.** An operation named here that is not there is a plan error: STOP and report it.
- **Ids shown in full wherever the user retypes them.**
- **Never render a bare UUID as a human column.**
- **Never silently choose among ambiguous candidates.** The resolved id is used to create or edit a record.
- `~/.config/cybernetics` holds a live admin session — read-only, never delete or overwrite.

## Existing interfaces

`renderTable`, `buildTemplate({schema, current?, bodyField?, header?})`, `templateFields`, `EditorService.run`, `AddressResolver.resolve(input, strategy)`, `ApiError`/`UsageError`/`ExitCode`, `ClientFactory`, `SettingsService`, `schemas[...]`, `positiveInt` (shared parser util), `morePagesNote` (`core/render/pagination-note.ts`), `formatLocalDateTime` (`core/render/format-date.ts`).

`src/commands/contacts/` is the closest reference for command shape; `src/core/resolve/resolver.ts` for strategy shape.

## Task Dependency Graph

```
1 (vocabulary module) ──┬── 4 (template) ── 5 (submit wiring)
2 + 3 (discovery cmds) ─┘   (2,3 independent of 1; may run first)
```

---

### Task 1: Vocabulary index and lookup strategies

**Files:** Create `src/core/resolve/vocabulary.ts`, `src/core/resolve/vocabulary.spec.ts`

**Interfaces produced:**
```ts
export type VocabularyKind =
  | 'contact-type' | 'contact-category'
  | 'knowledge-type' | 'knowledge-category'
  | 'tag' | 'company';

export type TagScope = 'knowledge' | 'contact' | 'project' | 'task' | 'shared';

/** One buffer field that carries keys rather than ids. */
export interface KeyBackedField {
  bufferField: string;   // what the user sees, e.g. 'type'
  dtoField: string;      // what the API takes, e.g. 'typeId'
  many: boolean;         // tags are a list; type/category/company are not
  kind: VocabularyKind;
  scope?: TagScope;      // required when kind === 'tag'
}

/** THE single declaration of which fields are key-backed. Not per-command. */
export const KEY_BACKED_FIELDS: Record<'contact' | 'knowledge', KeyBackedField[]>;

export class VocabularyIndex {
  constructor(client: ApiClient);
  /** key -> id. Throws UsageError (exit 2) listing up to 10 valid keys on a miss. */
  toId(field: KeyBackedField, value: string): Promise<string>;
  /** id -> key for rendering an edit buffer. Returns the raw id if unresolvable. */
  toKey(field: KeyBackedField, id: string): Promise<string>;
  /** Batch form for `many` fields. */
  toIds(field: KeyBackedField, values: string[]): Promise<string[]>;
  toKeys(field: KeyBackedField, ids: string[]): Promise<string[]>;
}
```

**Behaviour contract:**
- A well-formed UUID passes through `toId` unchanged, with **no HTTP call**.
- Bounded vocabularies (types, categories, tags) are fetched **once per `VocabularyIndex` instance** and indexed both directions. Two lookups of the same kind cost one request.
- **Companies are never fully indexed.** `toKey` fetches `GET /companies/{id}`.
  `toId` resolves by **name only** — VERIFIED: `listCompaniesSchema` exposes only
  `search`/`status`/`page`/`limit` (no `domain` filter), and `search` is `ilike`
  against `name` alone (`contact-company.repository.ts:63`). So: `GET /companies?search=<value>`
  to narrow, then require an **exact** name match client-side. A substring hit must
  never be silently accepted. Domain is not a resolution handle.
- **Tag resolution is scope-aware.** For `scope: 'contact'`, search scope `contact` then `shared`. A key present in **both** throws `UsageError` naming both and offering `contact:security` as the disambiguating form. An explicit `scope:key` input bypasses the fallback.
- Unknown key → `UsageError` listing up to **10** valid keys, then a count of the remainder and the `ls` command that shows them all.
- Company name matching several rows → `UsageError` listing candidates with **full** ids.
- Nothing is cached across instances; one instance per command invocation.

- [ ] **Step 1: Confirm the endpoints and their filters** in `src/generated/operations.ts` — `/tags` (scope filter), `/companies`, `/contact-vocabulary/{types,categories}`, `/knowledge-vocabulary/{types,categories}`. Report what query params `/companies` genuinely supports; the strategy depends on it.
- [ ] **Step 2: Write the failing spec** with a stubbed `ApiClient`. Cover: UUID passthrough with zero calls; single-request caching across two lookups; unknown key error naming ≤10 keys plus a remainder count; tag found in domain scope; tag found via `shared` fallback; tag in both scopes → ambiguity error offering `scope:key`; explicit `scope:key` bypassing fallback; company by domain; company by name; company name ambiguity listing full ids; `toKey` on an unresolvable id returning the raw id.
- [ ] **Step 3: Run it, confirm it fails** for the expected reason.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run it, confirm pass. Then the full suite** (`pnpm test`) and `pnpm typecheck`.

---

### Task 2: `cyb tags` and `cyb companies`

**Files:** Create `src/commands/tags/`, `src/commands/companies/` + specs; modify `src/app.module.ts`.

| Command | Operation |
|---|---|
| `tags ls` | `TagController_list` — `--scope` optional; no `--scope` lists every scope |
| `tags add` | `TagController_create` — `--scope` defaults to `shared`, per the DTO |
| `tags edit <id>` | `TagController_update` |
| `tags rm <id>` | `TagController_remove` — `--yes` |
| `companies ls` | `ContactCompanyController_list` |
| `companies get <id>` | `ContactCompanyController_get` |
| `companies add\|edit\|rm` | `create` / `update` / `remove` — `rm` needs `--yes` |

`tags ls` columns: `KEY`, `LABEL`, `SCOPE`, `USED`. `companies ls` columns: `NAME`, `DOMAIN`, `INDUSTRY`, `COUNTRY`.

Both lists must show the **full id** — these are retyped into `edit`/`rm` and into buffer fields.

- [ ] **Step 1: Confirm every endpoint** against `src/generated/operations.ts`.
- [ ] **Step 2: Write the failing spec** modelled on `src/commands/contacts/`: table rendering, filter pass-through, raw `--json`, withheld-row note, `--yes` enforcement including non-TTY refusal, `--no-edit` returning `false`.
- [ ] **Step 3: Run it, confirm failure.**
- [ ] **Step 4: Implement and register.**
- [ ] **Step 5: Run it, confirm pass.**

---

### Task 3: Vocabulary subcommands under contacts and knowledge

**Files:** Extend `src/commands/contacts/` and `src/commands/knowledge/` + specs; modify `src/app.module.ts`.

```
cyb contacts  type ls|add|edit|rm     category ls|add|edit|rm   # /contact-vocabulary/*
cyb knowledge type ls|add|edit|rm     category ls|add|edit|rm   # /knowledge-vocabulary/*
```

Columns for all four: `KEY`, `NAME`, `DESCRIPTION`, plus the full id.

These four groups are the same shape over four endpoint sets — **share one implementation parameterised by endpoint and label**, rather than four near-identical copies. Stage 3 accumulated seven copies of `positiveInt` before it was extracted; do not repeat that here.

- [ ] **Step 1: Confirm all 16 endpoints** against `src/generated/operations.ts`.
- [ ] **Step 2: Write the failing spec** — including one test per group proving the parameterised implementation targets the right path.
- [ ] **Step 3: Run it, confirm failure.**
- [ ] **Step 4: Implement and register.**
- [ ] **Step 5: Run it, confirm pass.**

---

### Task 4: Key-backed fields in the template

**Files:** Modify `src/core/editor/template.ts` + spec.

**Behaviour contract:**
- `buildTemplate` gains two optional inputs, so it stays free of HTTP concerns:

```ts
keyBacked?: KeyBackedField[];
/** id -> key, supplied by the caller (Task 5 passes VocabularyIndex.toKey/toKeys).
 *  Only invoked on an edit, and only for fields listed in keyBacked. */
resolveKeys?: (field: KeyBackedField, ids: string[]) => Promise<string[]>;
```

  `buildTemplate` therefore becomes async, or takes pre-resolved values — pick one and say which; if you make it async, every existing caller must be updated and the full suite must still pass.
 For each entry it renames `dtoField` to `bufferField` in the rendered frontmatter.
- On **create**, the field renders empty with the comment `# key — see: <ls command>` (or `# keys — see: …` when `many`).
- On **edit**, the current id(s) are reverse-mapped to keys via an injected resolver callback, so `template.ts` stays free of HTTP concerns. An unresolvable id renders as the raw id rather than failing the buffer.
- `templateFields` reports **buffer** field names, so the diff step compares what the user actually sees.
- Fields not listed in `keyBacked` are untouched — the existing behaviour must not regress.

- [ ] **Step 1: Write the failing spec** with a hand-written schema fixture and a stub resolver. Cover: rename on create; comment text; `many` rendering as a list; rename plus reverse-map on edit; unresolvable id falling back to the raw id; `templateFields` returning buffer names; a template with no `keyBacked` rendering exactly as before (guard against regression).
- [ ] **Step 2: Run it, confirm failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it, confirm pass. Run the full suite** — every existing template test must still pass.

---

### Task 5: Wire the submit path

**Files:** Modify `src/commands/contacts/contacts-{add,edit}.command.ts`, `src/commands/knowledge/knowledge-{add,edit}.command.ts` + specs.

**Behaviour contract:**
- Before submit, each buffer field in `KEY_BACKED_FIELDS` is mapped back to its DTO field with values resolved through `VocabularyIndex`. A `UsageError` from resolution propagates as exit 2 — it is fixable by editing, so it must reach the editor retry loop, not kill the command.
- `edit` still sends **only changed fields**, compared on **buffer** values.
- One `VocabularyIndex` per invocation, shared across every field.
- Flags accept keys too, so `--type customer` works alongside the buffer.

- [ ] **Step 1: Write the failing spec** with stubbed client, editor and index. Cover: a key resolving to an id before POST; multiple tag keys resolving; an unknown key surfacing as exit 2 through the retry loop rather than crashing; unchanged key-backed fields not appearing in a PATCH; a raw UUID passing through; `--type <key>` on the flag path.
- [ ] **Step 2: Run it, confirm failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it, confirm pass. Full suite and typecheck.**
- [ ] **Step 5: Live smoke test.** API on `:3000`, existing admin session read-only. Paste real output for `cyb tags ls`, `cyb contacts type ls`, `cyb companies ls`. Then, with a headless `$EDITOR`, create a contact whose buffer sets `type` and `tags` by key, confirm via `get --json` that the stored record holds the right **ids**, then edit it changing only the tag list, and remove it. Also prove a wrong key produces exit 2 with a list of valid keys. **Clean up everything you create and say so.**

---

## Done Criteria

- `cyb tags ls`, `cyb companies ls`, `cyb contacts type ls`, `cyb knowledge category ls` all render against the live API.
- A contact created through the editor with `type: customer` and `tags: [security]` stores the correct UUIDs.
- Editing that contact renders `type: customer`, not a UUID.
- A wrong key exits 2 and the error lists valid keys.
- A raw UUID still works in every key-backed field.
- Full suite green, typecheck clean, everything uncommitted.
