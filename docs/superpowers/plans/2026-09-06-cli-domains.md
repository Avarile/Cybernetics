# Cybernetics CLI — Domain Commands Implementation Plan (Stage 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Query, create and update contacts, projects/tasks, finance and invoices from the terminal — the domains the CLI was actually asked for.

**Architecture:** Four command groups over the machinery Stages 1 and 2 built. Each group is the same shape (`ls | get | add | edit | rm` plus domain extras) composed from `ApiClient`, `renderTable`, `EditorService` and `AddressResolver`. No new infrastructure; if a task needs new shared code, that is a signal to stop and report rather than invent it locally.

**Tech Stack:** Unchanged from Stages 1-2.

**Spec:** `docs/superpowers/specs/2026-09-06-cli-tool-design.md` (section 9)
**Preceding plans:** `2026-09-06-cli-foundation.md`, `2026-09-06-cli-editor-knowledge.md`

## Global Constraints

- **DO NOT COMMIT, STAGE, OR REWRITE HISTORY.** Another agent commits to this branch from a shared index. No `git add`, `git commit`, `git stash`, rebase, reset, or amend. Leave everything uncommitted.
- Node `>=20`, global `fetch`, CommonJS, no `"type": "module"`.
- Tests are `*.spec.ts` colocated beside source.
- Exit codes: `0` ok · `1` unexpected · `2` usage/validation/ambiguous · `3` auth required · `4` not found · `5` forbidden · `6` conflict.
- **Every list command:** renders via `renderTable`, supports `--limit` (default 20), `--page`, `--json` (raw envelope, unmodified), and **announces withheld rows** — silent truncation is forbidden.
- **Every create/update:** opens `$EDITOR` when no field flags are supplied; uses flags when they are; `--edit` forces, `--no-edit` forbids. `PATCH` sends **only changed fields**.
- **Every destructive command:** requires `--yes`, or an interactive confirmation on a TTY. Refuses in a non-TTY without `--yes`.
- **Every command:** accepts `-p/--profile` and `--api`.
- Addresses resolve through `AddressResolver`; a UUID always passes through. Ambiguity lists candidates and exits 2 — never guess.
- Endpoint paths, methods and query params come from `src/generated/operations.ts`. **Do not hand-write a path you have not confirmed there.**
- Do not modify `src/core/**` or `src/generated/**`. Extend `src/app.module.ts` only to register commands.

## Shared shape

Each task follows the same pattern, so `src/commands/knowledge/` from Stage 2 is your reference implementation. Match its structure, flag style, error handling and test approach. Where Stage 2 established a convention, follow it rather than inventing a second one.

## Task 1: Contacts

**Files:** `src/commands/contacts/` + specs; register in `app.module.ts`.

| Command | Operation | Notes |
|---|---|---|
| `ls` | `ContactController_list` — `GET /contacts` | query: `search,status,typeId,categoryId,companyId,tagId,page,limit` |
| `get <addr>` | `ContactController_get` | resolve via `contactByEmailOrName` |
| `add` | `ContactController_create` — `CreateContactDto` | body field `notes`, filetype `md` |
| `edit <addr>` | `ContactController_update` — `UpdateContactDto` | changed fields only |
| `rm <addr>` | `ContactController_remove` (204) | `--yes` required |
| `channel add\|rm` | `ContactController_addChannel` / `removeChannel` | `--kind`, `--value`, `--label`, `--primary` |
| `log` | `ContactController_addInteraction` | log an interaction |
| `interactions <addr>` | `ContactController_interactions` | paginated table |

`ls` table columns: `NAME`, `EMAIL`, `PHONE`, `STATUS`, `COMPANY`.

**Note:** `CreateContactDto` carries a cross-field rule ("Provide a name or an email address") that does **not** survive to JSON Schema. It arrives as a 400 with issues, which the editor loop surfaces — that is the designed behaviour, not a bug. Add a test asserting the 400 re-opens the buffer rather than crashing.

## Task 2: Projects and tasks

**Files:** `src/commands/projects/`, `src/commands/tasks/` + specs; register in `app.module.ts`.

| Command | Operation |
|---|---|
| `projects ls` | `ProjectController_list` — query `search,status,page,limit` |
| `projects get <addr>` | `ProjectController_get` — resolve via `projectByKey` |
| `projects add` / `edit` / `rm` | `create` / `update` / `remove` |
| `projects member add\|rm` | `addMember` / `removeMember` |
| `projects milestone ls\|add\|edit\|rm` | `milestones` / `createMilestone` / `updateMilestone` / `removeMilestone` |
| `tasks ls` | `TaskController_list` — query `projectId,status,assigneeUserId,milestoneId,search,page,limit` |
| `tasks get <addr>` | `TaskController_get` — resolve via `taskByProjectAndNumber` (`CYB-42`) |
| `tasks add` / `edit` / `rm` | `create` / `update` / `remove` |
| `tasks mv <addr>` | `TaskController_move` |
| `tasks time log\|ls` | `logTime` / `timeEntries` |

`projects ls` columns: `KEY`, `NAME`, `STATUS`, `DUE`. `tasks ls` columns: `REF` (`KEY-NUMBER`), `TITLE`, `STATUS`, `ASSIGNEE`, `DUE`.

**`tasks ls --project <key>`** must accept a project *key* and resolve it to `projectId` before querying.

## Task 3: Finance

**Files:** `src/commands/finance/` + specs; register in `app.module.ts`.

| Command | Operation |
|---|---|
| `finance accounts` | `FinanceController_accounts` |
| `finance accounts add` | `FinanceController_createAccount` |
| `finance tx ls` | `FinanceController_transactions` |
| `finance tx get <id>` | `FinanceController_transaction` |
| `finance tx add` | `FinanceController_createTransaction` — `CreateTransactionDto` |
| `finance tx status <id> <status>` | `FinanceController_setStatus` |
| `finance tx reverse <id>` | `FinanceController_reverse` — `--yes` required |
| `finance budgets` / `budgets add` | `budgets` / `createBudget` |
| `finance budgets at-risk` | `FinanceController_budgetsAtRisk` |
| `finance recurring ls\|add\|rm` | `recurringList` / `createRecurring` / `removeRecurring` |
| `finance report summary` | `FinanceController_summary` |
| `finance report forecast` | `FinanceController_forecast` |
| `finance report income` | `FinanceController_incomeByCategory` |
| `finance report spend` | `FinanceController_spendByCategory` |

`tx ls` columns: `DATE`, `DESCRIPTION`, `AMOUNT` (right-aligned), `CURRENCY`, `STATUS`, `ACCOUNT`.

**Money must never be rendered by naive float formatting.** Read how the API returns amounts (inspect a real `finance tx ls --json` response) and render exactly what it sends, right-aligned, without arithmetic. If amounts arrive as strings, keep them strings. Report what you found.

Report commands render whatever shape the endpoint returns; use `--json` as the escape hatch and keep the table best-effort.

## Task 4: Invoices

**Files:** `src/commands/invoices/` + specs; register in `app.module.ts`.

| Command | Operation |
|---|---|
| `invoices ls` | `InvoiceController_list` — query `status,contactId,companyId,projectId,page,limit` |
| `invoices overdue` | `InvoiceController_overdue` |
| `invoices get <id>` | `InvoiceController_get` |
| `invoices add` | `InvoiceController_create` — `CreateInvoiceDto`, body field `notes` |
| `invoices line add <id>` | `InvoiceController_addLine` |
| `invoices issue <id>` | `InvoiceController_issue` |
| `invoices bill-time <id>` | `InvoiceController_billTime` |

`ls` columns: `NUMBER`, `STATUS`, `DUE`, `TOTAL` (right-aligned), `CURRENCY`, `CONTACT`.

---

## Per-task steps (apply to all four)

- [ ] **Step 1: Confirm every endpoint** against `src/generated/operations.ts` — method, path, path params, query params. Any operation whose name in this plan does not exist there is a plan error: STOP and report it rather than guessing a path.
- [ ] **Step 2: Write the failing spec** with a stubbed `ApiClient`, `EditorService` and resolver, following `src/commands/knowledge/`'s spec as the model. Cover per group: list renders a table; list passes filters through; `--json` is raw and unmodified; withheld rows are announced; an address resolves; ambiguity exits 2; create with flags skips the editor; create with no flags opens it; update sends only changed fields; a destructive command without `--yes` refuses in a non-TTY.
- [ ] **Step 3: Run it, confirm failure.**
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Register in `app.module.ts`**, run the spec, confirm pass.
- [ ] **Step 6: Build and smoke-test live.** The API runs on `:3000` and `~/.config/cybernetics` holds a valid admin session — **use it read-only; do not delete or overwrite it.** Paste real output for each group's `ls`, its `--help`, and one `get` if records exist. Do NOT run create/update/delete against live data unless you create and then remove your own record, and state clearly which you did.
- [ ] **Step 7: Full suite and typecheck.**

## Done Criteria

- `cyb contacts ls`, `cyb projects ls`, `cyb tasks ls`, `cyb finance tx ls`, `cyb invoices ls` all render aligned tables against the live API.
- `cyb tasks get CYB-1` resolves a `KEY-NUMBER` address.
- `cyb contacts add` opens `$EDITOR`; a cross-field 400 re-opens the buffer with annotations.
- Every `--json` output is the raw envelope.
- Full suite green, typecheck clean, everything uncommitted.
