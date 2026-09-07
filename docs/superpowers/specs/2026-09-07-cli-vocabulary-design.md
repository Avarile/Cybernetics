# Cybernetics CLI — Vocabulary and Key-Backed Fields

**Date:** 2026-09-07
**Status:** Approved for planning
**Builds on:** `2026-09-06-cli-tool-design.md` (Stages 1–3, complete)

Make the CLI's classification fields usable: add commands for the vocabularies the
API exposes, and let editor buffers carry human keys instead of UUIDs.

## 1. The problem

Every `add` and `edit` buffer contains fields the user cannot fill in:

```yaml
# typeId: ""      # uuid
# categoryId: ""  # uuid
# tagIds: []
```

Four controllers — `ContactVocabulary` (8 endpoints), `KnowledgeVocabulary` (8),
`Tag` (5), `ContactCompany` (5) — have no CLI coverage, so there is no way to
discover a valid id. A user can create a contact but cannot classify one.

This is the same defect class already fixed twice at smaller scale during Stage 3:
`contacts channel rm` demanded a channel id with no `channel ls` to find it, and
`invoices line add` demanded an invoice id that `invoices ls` never rendered. Here
it is systemic and sits on the primary create/edit path.

## 2. Goals and non-goals

**Goals**

- Every vocabulary the CLI references is listable and manageable from the CLI.
- Classification fields in editor buffers accept human keys, resolved to ids on submit.
- A wrong key produces an error that contains the fix.
- A raw UUID always still works, in every field.

**Non-goals**

- Server-side changes. Resolution is entirely client-side; the DTOs continue to
  take UUIDs.
- Fuzzy or approximate matching. Every resolution below is either an exact match on
  a uniquely-indexed column or an explicit ambiguity error.
- Caching across invocations. Vocabularies are indexed per invocation only; a stale
  id is worse than a second request.

## 3. Constraints discovered in the schema

| Fact | Source | Consequence |
|---|---|---|
| `tags.key` is a lowercased slug, unique per **scope** | `shared.schema.ts` `tags_scope_key_idx` on `(scope, key)` | Tag resolution must be scope-aware; a key can exist in two scopes. |
| Tag scopes are `knowledge, contact, project, task, shared` | `tagScope` enum | `shared` is the cross-domain scope and must be searched as a fallback. |
| `GET /tags` accepts a `scope` filter | `tag.dto.ts:40` | Scoped fetches are cheap and bounded. |
| `contactTypes.key` is unique globally | `contact_types_key_idx` on `(key)` | Types and categories resolve by exact key, no scope needed. |
| `contactCompanies` has **no unique key column** | `contact.schema.ts` — only `contact_companies_domain_idx` on `domain`, which is nullable | Companies cannot use exact-key resolution. Needs its own strategy. |
| Company `name` is not unique | same | Name resolution must handle ambiguity explicitly. |
| `listCompaniesSchema` exposes only `search`/`status`/`page`/`limit` — **no `domain` filter** | `company.dto.ts` | Domain cannot be a resolution handle at all. |
| Company `search` is `ilike` against **`name` only** | `contact-company.repository.ts:63` | `search` is a narrowing device, not a matcher; exactness must be checked client-side. |

The company asymmetry is the single most important finding here: three of the four
vocabularies are small, bounded and uniquely keyed; the fourth is none of those.
Treating them identically would either index thousands of companies to render one
line, or silently pick the wrong company.

## 4. Discovery commands

Vocabulary nests under its owning domain, matching the API's own grouping:

```
cyb tags      ls | add | edit | rm          --scope contact|knowledge|project|task|shared
              # `tags ls` with no --scope lists every scope (the list DTO's scope
              # is optional); `tags add` with no --scope creates in `shared`,
              # matching the create DTO's own default.
cyb companies ls | get | add | edit | rm
cyb contacts  type ls|add|edit|rm     category ls|add|edit|rm    # /contact-vocabulary/*
cyb knowledge type ls|add|edit|rm     category ls|add|edit|rm    # /knowledge-vocabulary/*
```

These follow the six existing command groups exactly: `renderTable`, `--limit`
default 20, `--page`, `--json` emitting the raw envelope, withheld rows announced,
`--yes` on destructive commands, `-p/--profile` and `--api` everywhere.

`tags ls` columns: `KEY`, `LABEL`, `SCOPE`, `USED` (`usageCount` is already indexed).
`companies ls` columns: `NAME`, `DOMAIN`, `INDUSTRY`, `COUNTRY`.
Type and category lists: `KEY`, `NAME`, `DESCRIPTION`.

**Ids are shown in full wherever the user must retype them** — the rule established
by `channel ls`. A short id is only acceptable in a table nobody retypes from.

## 5. Key-backed buffer fields

| DTO field | Buffer field | Resolution |
|---|---|---|
| `typeId` | `type` | type `key`, exact |
| `categoryId` | `category` | category `key`, exact |
| `tagIds` | `tags` | tag `key`, scope-aware |
| `companyId` | `company` | `name`, exact (see §3) |

The field is **renamed**, not merely re-valued. `typeId: customer` would assert
something false about its own contents; `type: customer` does not.

A raw UUID passes through unchanged in every one of these fields, so there is always
an escape hatch when a key is ambiguous or absent.

### Rendering an edit buffer

The stored record carries ids, so rendering `type: customer` requires the reverse
mapping. Two strategies, chosen by whether the vocabulary is bounded:

- **Types, categories, tags** — fetch the list once per invocation and index both
  directions (`key→id` for submit, `id→key` for render).
- **Companies** — never index the set. On edit, fetch the single company by id
  (`GET /companies/{id}`). On submit, `GET /companies?search=<value>` (which the
  API matches as `ilike` against **name only**) and then require an **exact**
  name match client-side, so a substring hit is never silently accepted.

## 6. Error behaviour

Every failure is a `UsageError` (exit 2) whose message contains the fix.

- **Unknown key** — lists up to **10** valid keys, then a count of the
  remainder and the `ls` command that shows them all.
- **Tag key present in two scopes** — names both and offers the disambiguating
  `scope:key` form (`contact:security`).
- **Company name matching several rows** — lists candidates with their **full** ids.

Silently choosing among candidates is forbidden: the resolved id is subsequently
used to create or edit a record.

## 7. Cost

An edit buffer costs one additional request per key-backed field actually in use,
with bounded vocabularies indexed once per invocation. A contact edit with type,
category and tags set is three extra requests. This is accepted: the alternative is
UUIDs in the buffer, which is the defect being fixed.

A create buffer costs nothing extra until submit, because there are no ids to
reverse-map.

## 8. Field comments

A generated comment cannot list a whole vocabulary. Key-backed fields are commented
with their kind and the command that lists them:

```yaml
type: customer        # key — see: cyb contacts type ls
tags: [security]      # keys — see: cyb tags ls --scope contact
```

The complete list appears in the error when a key is wrong, which is where it is
actually needed.

## 9. Where the work lands

| File | Change |
|---|---|
| `src/core/resolve/vocabulary.ts` | new — index and lookup strategies |
| `src/core/editor/template.ts` | teach it key-backed fields: rename on render, `id→key` on edit |
| `src/commands/*/[add\|edit].command.ts` | map buffer fields back to DTO fields before submit |
| `src/commands/tags/`, `src/commands/companies/` | new groups |
| `src/commands/contacts/`, `src/commands/knowledge/` | vocabulary subcommands |
| `src/app.module.ts` | registration |

## 10. Open risks

- **Scope fallback.** `shared`-scope tags are searched for every domain, which is
  what "shared" means, but it makes `security` resolvable in two ways. The
  `scope:key` form exists for when that matters.
- **Companies resolve by name only, and names are not unique.** The `domain`
  column is uniquely indexed but is not exposed as a list filter, so it cannot be
  used to resolve; it is displayed in `companies ls` for human recognition only.
  A company whose name is shared with another is reachable only by UUID, which
  remains the guaranteed path.
- **Template complexity.** `buildTemplate` gains knowledge of which fields are
  key-backed. That is a real increase in a module whose current virtue is that its
  output is traceable to the schema. The mapping must be declared in one place, not
  scattered per command.
