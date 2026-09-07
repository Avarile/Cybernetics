# cyb — Cybernetics CLI

A terminal client for the Cybernetics API. Query, create and update contacts,
projects, tasks, finances, invoices and knowledge without leaving the shell —
composing longer records in `$EDITOR` rather than through flags.

Requires Node `>=20`. Talks to the API over HTTP with bearer tokens; no database
access and no credentials beyond your own login.

## Install

```bash
cd cli
pnpm install
pnpm build
```

The build produces `dist/cyb.js`, a single self-contained file with a shebang.
Put it on your `PATH`:

```bash
ln -sf "$PWD/dist/cyb.js" ~/.local/bin/cyb   # or any directory on your PATH
cyb --version
```

If your shell reports "command not found" after linking, run `rehash` (zsh
caches command locations per session).

The symlink points at `dist/`, so **re-run `pnpm build` after changing source**
for `cyb` to pick it up.

## Quick start

```bash
cyb config profile add dev --api http://localhost:3000 --email you@example.com --use
cyb login                    # prompts for your password, hidden
cyb whoami                   # confirms who you are
cyb contacts ls              # you're working
```

The session persists across invocations and across shells. You will not be asked
to log in again until the refresh token expires or you `cyb logout`.

## Configuration

Three sources, in precedence order: **flags → environment → config file**.

| Path | Mode | Contents |
|---|---|---|
| `~/.config/cybernetics/config.json` | `0644` | profiles, base URLs, default email |
| `~/.config/cybernetics/credentials.json` | `0600` | access and refresh tokens |

`$XDG_CONFIG_HOME` is honoured if set. The CLI **refuses to read
`credentials.json` if its permissions are looser than `0600`**, the way `ssh`
refuses a world-readable private key.

| Variable | Effect |
|---|---|
| `CYB_PROFILE` | use this profile |
| `CYB_API_URL` | override the base URL |
| `CYB_TOKEN` | supply a token directly — no credentials file needed (for CI) |
| `VISUAL` / `EDITOR` | which editor opens; falls back to `vi` |

Every command accepts `-p/--profile <name>` and `--api <url>` for a one-off
override.

### Profiles

```bash
cyb config profile add prod --api https://api.example.com --email you@example.com
cyb config profile use prod
cyb config profile ls          # * marks the current profile
```

## Addressing records

You should rarely need to type a UUID. Each domain accepts the handle a human
would actually use, and a raw UUID always works as a fallback.

| You type | Resolves via |
|---|---|
| `CYB-42` | project key + task number |
| `auth-token-rotation` | knowledge slug |
| `dana@example.com` | contact email |
| `"Dana Okafor"` | contact display name |
| `INV-2026-0008` | invoice number |
| any UUID | passed through unchanged, no lookup |

When a name matches more than one record the CLI **lists the candidates with
their full ids and exits 2**. It never guesses — the id it resolves is about to
be used to edit or delete something.

## Keys instead of UUIDs

Classification fields take human keys, not ids:

```bash
cyb tags ls --scope contact          # discover what exists
cyb contacts type ls
cyb contacts category ls
cyb companies ls

cyb contacts add --type customer --tags security,auth --company acme
```

A wrong key exits 2 and the error lists the valid ones:

```
error Unknown contact type key "custmer". Valid keys: partner, prospect,
customer, supplier, ... (41 more not shown.) See: cyb contacts type ls
```

Manage the vocabularies themselves the same way:

```bash
cyb tags add --key security --label Security --scope contact
cyb contacts type add --key customer --name Customer
cyb knowledge category ls
```

## The editor workflow

`add` opens `$EDITOR` when you pass no field flags; `edit` always opens it.
`--edit` forces the editor, `--no-edit` forbids it.

The buffer is YAML frontmatter plus a markdown body, opened as `.md` so your
highlighting, folds and spellcheck work:

```yaml
# cyb knowledge add — :wq to save, :cq to abort
# Text below the closing --- becomes the body. Dates are ISO (YYYY-MM-DD).
---
title: Auth token rotation
slug: auth-token-rotation      # max 255
type: runbook                  # key — see: cyb knowledge type ls
tags: [security, auth]
---

The refresh token is rotated on every use...
```

Field comments — allowed values, length limits, defaults — are generated from
the API's own schema, so they cannot drift from what the server accepts.

- **`:cq`** aborts and sends nothing.
- **No changes** aborts and sends nothing.
- **`edit` sends only the fields you changed**, never the whole record.
- **A rejected save reopens the buffer** with the problem marked in place and
  your other edits intact:

  ```yaml
  # ✗ slug: slug must be lowercase-with-dashes
  slug: NOT_A_Valid_Slug
  ```

- If a save fails in a way editing cannot fix (someone else changed the record,
  or you lack permission), your buffer is written to a recovery file and the
  path is printed. Your text is never silently discarded.

Knowledge updates carry the record version, so a concurrent edit returns a
conflict (exit 6) rather than overwriting someone else's work.

## Output

Human-readable aligned tables by default. Tables are plain text with no colour or
box-drawing, so they survive being piped, redirected or pasted. Error output is
colourised, and that colour turns itself off when stderr is not a terminal.

`--json` emits the **raw, unmodified API envelope** — unsorted, full ids, nothing
reshaped — so it is safe to pipe into `jq`.

Lists take `--page` and `--limit` (default 20) and **always say when rows were
withheld**. A truncated list never pretends to be complete.

Destructive commands require `--yes`, or confirm interactively on a terminal.
They refuse outright in a non-interactive shell without `--yes`.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | success |
| `1` | unexpected failure |
| `2` | usage error, validation failure, or an ambiguous address |
| `3` | authentication required — run `cyb login` |
| `4` | not found |
| `5` | forbidden |
| `6` | conflict — the record changed underneath you |

```bash
cyb whoami >/dev/null 2>&1 || echo "not logged in"   # exits 3
```

## Command reference

### Session

```
cyb login | logout | whoami | sessions
cyb config profile add|use|ls
```

`sessions` marks your current session with `*`, sorted by expiry.

### Contacts

```
cyb contacts ls | get | add | edit | rm
cyb contacts channel ls|add|rm        # emails, phones, socials
cyb contacts log <addr>               # record an interaction
cyb contacts interactions <addr>      # interaction timeline
cyb contacts type|category ls|add|edit|rm
```

### Knowledge

```
cyb knowledge ls | get | add | edit | rm
cyb knowledge publish <addr>          # set status: draft->review->published
cyb knowledge type|category ls|add|edit|rm
```

### Projects and tasks

```
cyb projects ls | get | add | edit | rm
cyb projects member add|rm
cyb projects milestone ls|add|edit|rm

cyb tasks ls | get | add | edit | rm
cyb tasks mv <addr>                   # move on the board
cyb tasks time ls|log
```

`tasks ls --project <key>` accepts a project key, not an id.

### Finance

```
cyb finance accounts | accounts ls | accounts add
cyb finance tx ls|get|add|status|reverse
cyb finance budgets | budgets ls | budgets add | budgets at-risk
cyb finance recurring ls|add|rm
cyb finance report summary|forecast|income|spend
```

Amounts are rendered exactly as the API sends them and are never parsed into
floating-point numbers. Totals come from the server's report endpoints, not from
client-side arithmetic.

There is no delete for a posted transaction — `status` can void one and
`reverse` posts a cancelling entry.

### Invoices

```
cyb invoices ls | overdue | get | add
cyb invoices line add <addr>
cyb invoices issue <addr>             # allocates the invoice number
cyb invoices bill-time <addr>         # bill logged time onto a draft
```

### Tags and companies

```
cyb tags ls|add|edit|rm --scope knowledge|contact|project|task|shared
cyb companies ls|get|add|edit|rm
```

`tags ls` with no `--scope` lists every scope; `tags add` defaults to `shared`.

## Development

```bash
pnpm test          # jest
pnpm typecheck     # tsc --noEmit
pnpm build         # tsup -> dist/cyb.js
pnpm verify        # typecheck + test
```

### Generated API contracts

`src/generated/` is produced from the API's OpenAPI document and **committed**,
so a build never needs a running server:

```bash
pnpm codegen          # regenerate from a running API
pnpm codegen:check    # CI: fail if the committed output is stale
```

Set `CYB_OPENAPI_URL` if the API is not on `http://localhost:3000`. Never edit
`src/generated/` by hand.

## Known limits

- **List filters still take ids, not keys.** `contacts add --type customer`
  works, but `contacts ls --type-id <uuid>` does not accept a key. Key
  resolution was wired into create and edit, not into list filters.
- **`cyb tasks get CYB-42` pages client-side.** The task list endpoint has no
  filter on task number, so resolving a `KEY-NUMBER` address fetches pages and
  matches locally. It warns on stderr past three pages.
- **Company resolution is by name only.** The API exposes no filter on company
  domain, so a company whose name is shared with another is reachable only by
  UUID.
- **`projects member rm` needs a user id you cannot discover.** `GET
  /projects/{id}/members` exists but has no `cyb projects member ls`, so the id
  that `rm` requires is not obtainable through the CLI. Use `--json` on the
  project until this is added.
- **Not covered:** search, files, mailbox, notifications, agent chat, and system
  administration all have API endpoints with no commands yet.
