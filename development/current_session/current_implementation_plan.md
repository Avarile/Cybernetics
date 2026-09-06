========================================================================================
CYBERNETICS -- IMPLEMENTATION PLAN
========================================================================================

Status: Complete -- all seven phases built, Date: 2026-09-06, Follows: current_design.md
Prerequisite state: migration 0013_useful_vanisher applied; reference data seeded.

CONTENTS
--------

  1. Where Things Stand
      Module boundary rule, learned twice
      Two seams introduced in Phase 0 that later phases must use
  2. Sequencing Rules
  3. Phase 0 -- Foundations Runtime ✅ COMPLETE
  4. Phase 1 -- Authorization and User Management
      4.1 Permission resolution
      4.2 Profiles and preferences
  5. Phase 2 -- CRM
  6. Phase 3 -- Knowledge
  7. Phase 3.5 -- Search Projection (cross-cutting)
      7.1 The one change to existing code
      7.2 Projections
      7.3 The fan-out that must be queued
  8. Phase 4 -- Projects
  9. Phase 5 -- Notifications
  10. Phase 6 -- Finance
  11. Test Strategy
  12. Watch Items
  13. What Was Built
      Verification
  14. What Is Left
      Carried into every later change

----------------------------------------------------------------------------------------

========================================================================================
1. WHERE THINGS STAND
========================================================================================

The data model is in the database. Phase 0 now runs on part of it; the capability
modules do not exist yet.

  Layer                                         | State
  ----------------------------------------------+-----------------------------------------------
  Schema (10 files, 57 tables, 51 enums)        | ✅ written, typechecked, exported from
                                                | schema/index.ts
  Migration 0013                                | ✅ generated, reviewed, applied to
                                                | cybernetics_cli
  Seed data (11 vocabularies, idempotent)       | ✅ applied and re-run clean
  Schema specs                                  | ✅ one per file, locking enums and fail-closed
                                                | defaults
  Phase 0 foundations (tags, comments,          | ✅ built, tested, e2e-verified
  attachments, activity, flags, events,         |
  retention)                                    |
  Phase 1 authorization + user management       | ✅ resolver, cache, guard, boot assertion,
                                                | profiles, preferences
  Phase 2 CRM                                   | ✅ contacts, channels, companies, vocabularies,
                                                | relationships, interactions
  Phase 3 knowledge (+ 3.5 search projection)   | ✅ records, ACL, vocabularies, contact links,
                                                | knowledge collection
  Phase 4 projects                              | ✅ projects, members, tasks, dependencies,
                                                | watchers, planning, links, time
  Phase 5 notifications                         | ✅ outbox, drain, templates, preferences,
                                                | suppressions
  Phase 6 finance                               | ✅ accounts, ledger, budgets, recurring,
                                                | invoicing, payments

Every phase is implemented. What follows is the record of what was built and the
decisions taken while building it.

Module boundary rule, learned twice
-----------------------------------

SharedModule and SystemModule both had to be split during implementation, for the same
reason each time: a module on the authentication path must not acquire heavy transitive
dependencies.

  - SharedModule imported FileProcessorModule (for attachment authorization), which
    needs MinIO and the BullMQ connection. Since AuthorizationModule imports shared and
    UsersModule imports authorization, logging in came to require object storage -- and
    seven e2e suites failed at once. Fixed by moving AttachmentService into its own
    AttachmentsModule; AttachmentRepository stays in shared so EntityCascadeService can
    still purge.
  - UsersModule imported the whole SystemModule to read one setting. Fixed by extracting
    SystemSettingsModule, the same way SystemAuditModule was already extracted.

The rule that falls out: a leaf module depends on infrastructure only, and when a leaf
needs a feature service, the consumer moves out rather than the dependency moving in.

Two seams introduced in Phase 0 that later phases must use
----------------------------------------------------------

Neither was in the original plan; both came out of building it, and both are
load-bearing for what follows.

EntityAccessRegistry (src/features/shared/entity-access.registry.ts) -- comments and
attachments are polymorphic, so their readability is entirely their parent's. Rather
than import every feature module (a cycle) or trust the caller's entityType (a hole),
each module registers a resolver:

    [ ts ]
    registry.register('project', (id, principal) => this.projects.canRead(id, principal));

An unregistered entity type is denied to non-admins. Until phases 2-4 register theirs,
comments on projects/knowledge/contacts are admin-only -- which is the correct state for
a type nothing can yet vouch for. Registering is a one-line addition in each phase and
is listed in that phase below.

RetentionPurgeRegistry (src/infrastructure/retention/retention.registry.ts) -- lives in
infrastructure, not in the system feature, because both sides need it. Each module
declares how its own table is purged:

    [ ts ]
    this.retention.register('activity_log', (cutoff, limit) => this.repo.purgeOlderThan(cutoff, limit));

It started inside SystemModule and had to move: owning it there forced SystemModule to
import the modules whose tables it purges, which dragged MinIO and the file queue into a
module-subset e2e context that only wanted system settings, and broke eight existing
tests. The lesson generalises -- a sweep must never import the features whose rows it
deletes.

----------------------------------------------------------------------------------------

========================================================================================
2. SEQUENCING RULES
========================================================================================

Ship one phase at a time, behind its flag. Seven feature_flags rows are seeded disabled
(module.rbac, module.user_profiles, module.crm, module.knowledge, module.projects,
module.notifications, module.finance). A phase is done when its flag can be turned on in
production and turned off again without a deploy.

Phase order is fixed by dependency, not preference: 0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6. CRM
precedes knowledge and projects because both reference contacts; notifications follow
projects because the events worth sending are project events; finance is last because it
references everything.

Definition of done, every phase:

  1. Repository extends BaseRepository, adds findLiveById and a paginated list. No
     findAll.
  2. Service owns the invariants named in this plan -- not the controller, not the
     repository.
  3. Every route declares @Roles (boot assertion enforces it) and, where applicable,
     @RequirePermission.
  4. Scope resolvers return data, not exceptions, with an exhaustive truth-table spec
     (follow read-scope.spec.ts).
  5. pnpm verify passes: typecheck, lint, unit tests, module graph.
  6. E2E spec covering the cross-user isolation case (follow
     tenancy-isolation.e2e-spec).
  7. Feature flag flipped on in dev, exercised, flipped off, then merged.

----------------------------------------------------------------------------------------

========================================================================================
3. PHASE 0 -- FOUNDATIONS RUNTIME ✅ COMPLETE
========================================================================================

The cross-cutting services every later phase calls. Delivered as described below, with
two additions (the registries in §1) and one substitution: entity-cascade.util.ts
shipped as EntityCascadeService, since it needs both repositories injected.

New: src/features/shared/

  File                                       | Responsibility
  -------------------------------------------+--------------------------------------------------
  tag.repository.ts / tag.service.ts         | Tag vocabulary CRUD; scope filtering; usageCount
                                             | maintenance
  comment.repository.ts / comment.service.ts | Polymorphic comments; mention resolution ->
                                             | mentions array
  attachment.service.ts                      | entity_attachments over the existing FileService;
                                             | reverse-reference check before purge
  activity.service.ts                        | The only writer of activity_log. Takes a
                                             | Principal, derives actorKind / actorUserId /
                                             | actorCredentialId
  entity-cascade.util.ts                     | deleteEntityGraph(entityType, entityId, tx) --
                                             | the application-level cascade the two polymorphic
                                             | tables need

New: src/features/system/ additions

  File                                          | Responsibility
  ----------------------------------------------+-----------------------------------------------
  feature-flag.service.ts                       | Flag evaluation with Redis cache + pub/sub
                                                | invalidation
  system-event.service.ts                       | Structured event emission (severity >= warn or
                                                | a named consumer)
  retention.scheduler.ts                        | Reads data_retention_policies, bounded DELETE
                                                | per enabled row, writes back lastRunAt /
                                                | lastDeletedCount
  setting-revision wiring in                    | Write a system_setting_revisions row inside
  SystemSettingsService                         | the same transaction as every settings update;
                                                | enforce version optimistic concurrency

Invariants to enforce in code

  - ActivityService is the sole writer of activity_log. A feature writing that table
    directly is a review rejection -- one writer is what keeps actorKind honest.
  - The retention sweep processes one policy per tick with a row limit, never an
    unbounded DELETE. A purge that locks the table for a minute is worse than a purge
    that takes an hour.
  - The two disabled policies (email_messages, search_records) must stay disabled: add a
    spec asserting the seeder ships them enabled = false, so nobody flips them by
    editing a seed file.

Delivered. 19 files under src/features/shared/ and src/features/system/, 9 new error
codes, 4 new controllers (/tags, /comments, /attachments, /activity) and 3 system ones
(/system/feature-flags, /system/retention, /system/events).

Verified: unit specs for every service (fail-closed truth table for the access registry,
actor-derivation table for activity, batching/skip/failure paths for retention,
targeting and expiry for flags), plus test/shared-foundations.e2e-spec.ts covering the
isolation cases -- a non-admin gets 404 (not 403) on an entity nothing vouches for,
/activity/me ignores a spoofed actorUserId, and the cross-system feed stays admin-only.

Two defects found by those tests, both fixed: FeatureFlagService.toPublic threw on an
undefined expiresAt (a strict !== null check that undefined walks straight through), and
the seeder helper derived a row's property name from the SQL column name, so any column
whose two names differ re-inserted on every run and tripped its unique index.

----------------------------------------------------------------------------------------

========================================================================================
4. PHASE 1 -- AUTHORIZATION AND USER MANAGEMENT
========================================================================================

The highest-risk phase: it touches the request path for every route that follows.

4.1 Permission resolution
-------------------------

New: src/features/auth/permissions/

  File                            | Responsibility
  --------------------------------+-------------------------------------------------------------
  permission.repository.ts        | Reads role grants, user roles, user exceptions -- all
                                  | filtered on expiresAt
  permission-resolver.service.ts  | The algorithm in design §5.9: admin short-circuit -> role
                                  | union -> user allow -> user deny
  permission-cache.service.ts     | Redis perm:user:{id}, TTL + pub/sub invalidation. Mirror
                                  | SessionCacheService exactly, including its
                                  | enableOfflineQueue handling
  permissions.guard.ts            | Global guard, runs after RolesGuard
  require-permission.decorator.ts | @RequirePermission('project.task.update')
  permission-catalog.assertion.ts | Boot check both ways: every decorator resolves to a seeded
                                  | row, and no seeded row is orphaned

Non-negotiable invariants

  - Admin short-circuits before any lookup. isAdmin(principal) returns true -> allow.
    The RBAC layer only grants.
  - Nothing goes in the JWT. Resolution is per request from cache.
  - Every write to user_roles, role_permissions, user_permissions or users.role
    publishes an invalidation. A role edit invalidates every member -- enqueue that
    fan-out, never inline it.
  - Deny wins, and it is set-difference, not an ordered rule list.
  - A route with no @RequirePermission behaves exactly as today. Adoption is per-route.

Risk: a caching bug here silently grants or denies across the whole API. Mitigation: the
resolver is a pure function over fetched rows with an exhaustive spec; the cache is a
separate class with its own spec; an e2e test asserts that revoking a role takes effect
on the next request, not the next token.

4.2 Profiles and preferences
----------------------------

src/features/users/ additions: profile.repository.ts, profile.service.ts (lazy row
creation on first write), preference.service.ts (resolution order: user preference ->
system_settings.defaultJson -> compiled default), and users.controller.ts routes for
own-profile read/update.

Acceptance: a user edits their own profile and cannot edit another's; a demoted user
loses access on their next request with the same token; the permission catalog assertion
fails the boot when a decorator names a missing permission.

----------------------------------------------------------------------------------------

========================================================================================
5. PHASE 2 -- CRM
========================================================================================

New: src/features/contacts/ -- repositories and services for contacts, channels,
companies, types, categories, relationships, interactions; controllers for each; DTOs
with class-validator.

The three things that carry risk

  1. Automatic deduplication (Q5). Every write path goes through
     ContactService.upsertByEmail(), which normalizes (lowercase, trim) and writes with
     ON CONFLICT (email_normalized) WHERE is_deleted = false DO UPDATE. A bare insert
     anywhere in ingest will fail on valid mail -- this is the single most likely bug in
     the phase. Cover it with a spec that ingests the same address twice and asserts one
     row.
  2. Inbound email -> interaction. Extend the mailbox pipeline: after email_messages is
     persisted, resolve from_address against contact_channels_value_lookup_idx; create
     the contact if unknown (source = 'inbound_email', no owner); insert a
     contact_interactions row keyed by email_message_id. The partial unique index makes
     a re-sync idempotent -- rely on it rather than checking first.
  3. Scope. resolveContactScope(contact, principal): admin/system -> full; owner ->
     full; visibility = 'shared' -> read for any authenticated user; else deny.
     Truth-table spec.

Search: bootstrap a contacts collection (owner_scoped, owner field visibleUserIds) once
§7.1 below lands.

Acceptance: two inbound emails from one address produce one contact and two
interactions; a private contact is invisible to a second non-admin user through both the
API and search.

----------------------------------------------------------------------------------------

========================================================================================
6. PHASE 3 -- KNOWLEDGE
========================================================================================

New: src/features/knowledge/ -- repositories/services for knowledge, types, categories,
tags, ACL, contact links; a knowledge.controller.ts; a review.scheduler.ts.

Key work

  - knowledge-access.resolver.ts -- design §9.5, fail-closed, grant-only, exhaustive
    truth table. Grants are filtered on expiresAt at read time, not only by a sweep.
  - Materialized-path maintenance for knowledge_categories: insert/move rewrites the
    subtree in one transaction; reject a move whose target path contains the moving
    node's id.
  - review.scheduler.ts -- reads knowledge_review_due_idx, emits knowledge.review_due
    (queued as a notification once phase 5 lands; until then, a system_event_log row).
  - Slug generation with collision handling against the partial unique index.

Deliberately not built: revision history (Q3).

Acceptance: a private record is invisible to a non-grantee in API and search; an expired
grant stops working without any sweep having run; publishing sets publishedAt and
schedules reviewDueAt from the type's default interval.

----------------------------------------------------------------------------------------

========================================================================================
7. PHASE 3.5 -- SEARCH PROJECTION (CROSS-CUTTING)
========================================================================================

Do this once, before knowledge and projects both need it.

7.1 The one change to existing code
-----------------------------------

features/search-service/document-validator.ts, validateVisibility:

    [ ts ]
    // before
    if (spec.type !== 'string') { ... }
    // after
    if (spec.type !== 'string' && spec.type !== 'string[]') {
      errors.push(`ownerField "${ownerField}" must be of type string or string[] (is ${spec.type})`);
    }

resolveReadScope needs no change -- it already emits { field, userId }, and Meilisearch
matches field = value against an array attribute by containment. Add a spec case for the
array shape.

7.2 Projections
---------------

  Source    | Collection | Visibility   | Owner field
  ----------+------------+--------------+---------------
  knowledge | knowledge  | owner_scoped | aclUserIds
  contacts  | contacts   | owner_scoped | visibleUserIds
  projects  | projects   | owner_scoped | memberUserIds
  tasks     | tasks      | owner_scoped | memberUserIds

Each gets a bootstrap following DocumentsCollectionBootstrap -- including its retry
loop, which exists because boot ordering between bootstraps is undefined.

7.3 The fan-out that must be queued
-----------------------------------

Denormalized ACL arrays go stale on membership changes, not just entity edits:

  Change                                        | Reprojects
  ----------------------------------------------+-----------------------------------------
  knowledge_access_control insert/delete/expiry | that knowledge row
  project_members insert/delete                 | that project and every task in it
  contacts.visibility / owner_user_id change    | that contact
  role_permissions / user_roles change          | every knowledge row granted to that role

The last two are unbounded and must be queued on QUEUE_NAMES.searchIndexing. Inlining
them puts a thousand-row loop inside the request that edited a role.

Accepted and documented: ACL propagation is eventually consistent. A revoked grant may
linger in search results for seconds; it never lingers in reads, because get() re-checks
against Postgres. Search can leak a title, never a body.

----------------------------------------------------------------------------------------

========================================================================================
8. PHASE 4 -- PROJECTS
========================================================================================

New: src/features/projects/ -- projects, members, milestones, tasks, dependencies,
watchers, goals, links, time entries.

Key work

  - project-scope.resolver.ts -- design §10.2, returning the member role or null.
    Everything beneath a project inherits it; there is no per-task ACL.
  - Task numbering: allocate from projects.task_seq with UPDATE projects SET task_seq =
    task_seq + 1 RETURNING task_seq inside the insert transaction. Never max(number) +
    1.
  - Board ordering: LexoRank in sort_rank; a move writes one row. Add the rebalance path
    and a spec for rank exhaustion between two neighbours.
  - Dependency cycles: service-side walk before insert; the DB check only catches
    self-edges.
  - Denormalization upkeep: projects.progressPct on task write, tasks.spentMinutes on
    time entry write, both inside the same transaction, both with a rebuild sweep.
  - Watchers are populated by the events that imply them (assigned, commented,
    mentioned, reporter) -- this is the recipient set phase 5 reads.
  - Agent tools (features/mastra/tools/) for create-task / list-my-tasks, carrying the
    triggering user's principal -- never admin.

Acceptance: concurrent task creation in one project produces gapless distinct numbers; a
non-member cannot read a private project's tasks via API or search; an unowned
agent-created project appears in the claim queue.

----------------------------------------------------------------------------------------

========================================================================================
9. PHASE 5 -- NOTIFICATIONS
========================================================================================

New: src/features/notifications/

  File                          | Responsibility
  ------------------------------+---------------------------------------------------------------
  notification.service.ts       | enqueue(event, recipients, payload) -- writes outbox rows in
                                | the caller's transaction
  recipient-resolver.service.ts | Event -> recipients (assignee, watchers, mentions, project
                                | members), then preferences, then suppressions
  template-renderer.ts          | Logic-less {{ var }} substitution; validates payload against
                                | the template's declared variables
  notification.processor.ts     | BullMQ consumer: render -> MailerService -> status +
                                | notification_delivery_attempts row
  digest.scheduler.ts           | Collapses digest_group_key rows into one email per window
  suppression.service.ts        | Bounce/complaint handling; writes suppressions
  notification.controller.ts    | Own-history list, preference read/update

Invariants

  - The outbox row is written in the same transaction as the business change. Sending
    inside the transaction emails on rollback; sending after commit loses the message on
    a crash. This is the pattern search_records.index_state already uses -- reuse it, do
    not invent a variant.
  - dedupeKey on every enqueue. A retried job must not send twice.
  - Mandatory events bypass preferences but never bypass a hard bounce or complaint
    suppression.
  - A suppressed send records suppressed, never failed.
  - Retry with exponential backoff, mirroring search-indexing.processor.ts.

New queue: add notificationSend to QUEUE_NAMES and register it in the queue module (note
the existing DI rule: queue modules import QueueModule rather than self-providing).

Acceptance: a rolled-back task assignment sends nothing; a retried job sends once; an
address with a hard bounce is skipped and recorded as suppressed; a password reset still
arrives for a user who has switched everything off.

----------------------------------------------------------------------------------------

========================================================================================
10. PHASE 6 -- FINANCE
========================================================================================

New: src/features/finance/ -- accounts, categories, budgets, transactions, recurring
schedules, invoices, line items, payments.

Key work

  - ledger.service.ts -- posting a transaction updates financial_accounts.currentBalance
    and any matching budgets.spentAmount in the same transaction. Corrections are
    reversing entries; a cleared row is never edited.
  - invoice.service.ts -- gapless numbering from a system_settings template inside the
    issuing transaction; billToSnapshot captured at issue; immutable once out of draft
    (service-enforced, with a BEFORE UPDATE trigger recommended if finance is ever
    audited).
  - billing.service.ts -- groups unbilled time_entries (via time_entries_unbilled_idx)
    into line items and stamps invoiceLineItemId, which is the double-billing lock.
  - recurring.scheduler.ts -- materializes due schedules into pending transactions (or
    posts them when autoPost), advances nextDueOn, and uses lastGeneratedOn for
    idempotency.
  - budget-alert.scheduler.ts -- emits budget.threshold_reached at alertThresholdPct.
  - Income reporting reads transactions_kind_date_idx; expected-vs-received reconciles
    recurring_transactions against generated rows.

Acceptance: the same hour cannot be billed twice; a recurring schedule run twice on one
day generates one transaction; a cleared transaction cannot be edited, only reversed;
balances recomputed from the ledger match the denormalized currentBalance.

----------------------------------------------------------------------------------------

========================================================================================
11. TEST STRATEGY
========================================================================================

Follow what the repo already does -- this is not new machinery.

  Level            | What                                     | Model
  -----------------+------------------------------------------+---------------------------------
  Schema specs     | Enum vocabularies + fail-closed defaults | *.schema.spec.ts (done)
  Resolver specs   | Exhaustive truth tables for every        | read-scope.spec.ts
                   | scope/permission resolver                |
  Service specs    | Invariants: numbering, dedup,            | existing service specs
                   | idempotency, denormalization             |
  Repository specs | Partial-index predicates actually match  | search-record.repository.spec.ts
                   | the queries                              |
  E2E              | Cross-user isolation per module;         | tenancy-isolation.e2e-spec
                   | outbox-on-rollback; revocation timing    |

The specs that matter most, because they cover what silently breaks: permission cache
invalidation timing, contact dedup under concurrent ingest, task-number allocation under
concurrency, notification idempotency, and ACL propagation to search.

----------------------------------------------------------------------------------------

========================================================================================
12. WATCH ITEMS
========================================================================================

  Item                          | Trigger                       | Action
  ------------------------------+-------------------------------+-------------------------------
  Log table growth              | any of activity_log,          | convert to monthly PARTITION
                                | system_event_log,             | BY RANGE (created_at), switch
                                | notifications, notification_d | purge to DETACH+DROP (design
                                | elivery_attempts > ~10M rows, | §4.7)
                                | or a purge outlasting its     |
                                | interval                      |
  Shared email addresses        | support reports two people    | the documented workaround is a
                                | merged into one contact       | non-primary channel row;
                                |                               | revisit only if it recurs
  Permission cache              | any report of stale           | the resolver is pure and
                                | authorization                 | specced; suspect the
                                |                               | invalidation fan-out first
  email_messages /              | someone proposes enabling     | require an export first --
  search_records retention      | them                          | these purge content, not logs
  Agent-created unowned         | claim queue grows             | assign a default owner policy,
  projects                      |                               | or require a triggering user

----------------------------------------------------------------------------------------

========================================================================================
13. WHAT WAS BUILT
========================================================================================

  Module                     | Files | Notable
  ---------------------------+-------+----------------------------------------------------------
  features/shared            | 14    | tags, comments, attachments, activity,
                             |       | EntityAccessRegistry, EntityCascadeService,
                             |       | materialized-path helpers
  features/authorization     | 9     | PermissionResolver, epoch-invalidated Redis cache,
                             |       | PermissionsGuard, @RequirePermission, boot assertion,
                             |       | RBAC admin
  features/users (extended)  | 4     | profiles, preferences, own-profile controller
  features/contacts          | 13    | contacts + channels + companies + vocabularies +
                             |       | relationships + interactions, resolveContactAccess
  features/knowledge         | 13    | records, grant-only ACL, vocabularies, contact links,
                             |       | search projection, review sweep
  features/projects          | 15    | projects, members, tasks, dependencies, watchers,
                             |       | milestones, goals, links, time, LexoRank board ordering
  features/notifications     | 8     | outbox, drain processor, templates, preferences,
                             |       | suppressions
  features/finance           | 11    | exact decimal money, ledger, budgets, recurring
                             |       | income/expense, invoicing, payments
  features/system (extended) | 12    | feature flags, event log, retention sweep, setting
                             |       | revisions

Pure, exhaustively specced units -- the pieces where a mistake is silent:
resolveContactAccess, resolveKnowledgeAccess, resolveProjectAccess, PermissionResolver,
lexorank, money.util, template-renderer, materialized-path.

Verification
------------

test/app-boot.e2e-spec.ts boots the real AppModule -- not a module subset -- and asserts
what main.ts asserts before it listens: every route declares a policy, every
@RequirePermission resolves to a seeded permission, every scoped entity type has an
access resolver, and every governed log table has a retention purge. The other e2e
suites build subsets and would not have caught a broken composition root.

========================================================================================
14. WHAT IS LEFT
========================================================================================

Deliberately not built, in rough priority order:

  1. Notification emission from the feature modules. The pipeline exists and drains; the
     events that should fill it (task.assigned, invoice.overdue, knowledge.review_due)
     are enqueued from nowhere yet. Each is a call to NotificationService.enqueue inside
     the caller's transaction -- the argument exists for exactly that.
  2. Digest collapsing. digest_group_key is written and indexed; the sweep that folds a
     group into one email is not written.
  3. Bounce ingestion. NotificationAdminService.recordBounce exists but nothing calls
     it; wiring it to the IMAP pipeline closes the loop that keeps the sending domain
     healthy.
  4. Agent tools for the new modules (create task, search knowledge), carrying the
     triggering user's principal rather than admin.
  5. Search reprojection on RBAC change. A role's members change what an ACL-scoped
     knowledge record projects; the projection is correct on every knowledge and grant
     write, but a user_roles change does not yet trigger it.
  6. Invoice PDF rendering into pdfFileId.
  7. Partitioning of the four log tables, per the threshold in the design's §4.7.

Carried into every later change
-------------------------------

  - Register an EntityAccessRegistry resolver for each new entity type, or its comments
    and attachments stay admin-only.
  - Register a RetentionPurgeRegistry purge for any new log-shaped table, and add its
    data_retention_policies row.
  - Add each new controller to src/common/route-policy.coverage.spec.ts -- the boot
    audit is the guarantee, that spec is the fast feedback.
  - A module-subset e2e context must import the infrastructure its module transitively
    needs; AppModule supplies it in production, a subset must not assume it.
  - Keep leaf modules free of feature dependencies (see the boundary rule in §1).
