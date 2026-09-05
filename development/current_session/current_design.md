========================================================================================
CYBERNETICS -- FEATURE-BASED DATA MODEL DESIGN
========================================================================================

Status: Approved -- schema implemented (migration 0013_useful_vanisher, applied), Date:
2026-09-06, Target: api/src/infrastructure/database/schema/
Stack: PostgreSQL 16, Drizzle ORM + drizzle-kit, NestJS, Meilisearch (read model), MinIO
(blobs), BullMQ (async), Redis (cache)

CONTENTS
--------

  1. Scope and Reading Guide
  2. Conventions Inherited From the Existing Schema
      2.1 baseColumns and soft delete
      2.2 Uniqueness under soft delete
      2.3 Enums vs lookup tables
      2.4 JSONB discipline
      2.5 Secrets
      2.6 Principal-aware ownership
      2.7 Postgres is the source of truth; Meilisearch is a rebuildable read model
      2.8 Naming
      2.9 File layout
  3. Domain Map
  4. Cross-Cutting Design Decisions
      4.1 Tagging: one vocabulary, per-domain joins
      4.2 Controlled polymorphism -- and where it is banned
      4.3 tags
      4.4 comments
      4.5 entity_attachments
      4.6 activity_log -- and how it differs from system_audit_log
      4.7 Growth strategy for high-volume tables
      4.8 Money representation
      4.9 Ordering of user-sortable lists
  5. Authentication & Authorization
      5.1 What stays exactly as it is
      5.2 The authorization problem to solve
      5.3 The three-layer model
      5.4 permissions
      5.5 roles
      5.6 role_permissions
      5.7 user_roles
      5.8 user_permissions (per-user exception -- optional, phase 2)
      5.9 Resolution algorithm (single implementation, PermissionResolver)
      5.10 Row-level scope (layer 3) by module
  6. System-Data Management
      6.1 system_settings -- extensions
      6.2 system_setting_revisions (new, append-only)
      6.3 system_event_log (new, append-only, partitioned) -- and what does not go in it
      6.4 data_retention_policies (new)
      6.5 feature_flags (new)
      6.6 Unchanged
  7. User Management
      7.1 Why users is not extended in place
      7.2 user_profiles
      7.3 user_preferences
      7.4 Teams -- deliberately not built
      7.5 User activity
  8. Human Relationship Management (CRM)
      8.1 Requirement mapping
      8.2 contacts
      8.3 contact_channels
      8.4 contact_types
      8.5 contact_categories
      8.6 contact_companies
      8.7 contact_relationships (beyond the listed five -- recommended)
      8.8 contact_interactions (beyond the listed five -- recommended)
  9. Knowledge Management
      9.1 knowledge
      9.2 knowledge_types
      9.3 knowledge_categories
      9.4 knowledge_tags
      9.5 knowledge_access_control
      9.6 knowledge_contact_links -- the contact reference
      9.7 Deliberately not included
      9.8 Relationship to the existing document pipeline
  10. Project Management
      10.1 projects
      10.2 project_members
      10.3 milestones
      10.4 tasks
      10.5 task_dependencies
      10.6 task_watchers
      10.7 goals
      10.8 project_knowledge_links -- the knowledge reference
      10.9 project_contact_links -- the contact reference
      10.10 time_entries
  11. Notification Management
      11.1 Why an outbox table rather than "just send it"
      11.2 notification_event_types
      11.3 notification_templates
      11.4 notification_preferences
      11.5 notifications (outbox + history, partitioned)
      11.6 notification_delivery_attempts (append-only, partitioned)
      11.7 notification_suppressions
      11.8 Body storage -- an explicit decision
  12. Financial Management
      12.1 currencies and fx_rates
      12.2 financial_accounts
      12.3 financial_categories
      12.4 budgets
      12.5 transactions
      12.6 recurring_transactions
      12.7 invoices
      12.8 invoice_line_items and payments
      12.9 Upgrade path to double-entry
  13. Search Integration
      13.1 Projection map
      13.2 One required change to the search service
      13.3 Keeping the denormalized ACL arrays correct
  14. Access-Control Summary
  15. Decisions Taken
      Two retention policies ship disabled, deliberately
  16. Delivery Plan
  17. Implementation Status
  18. Appendix A -- Enum Catalog
  19. Appendix B -- Design Rules Applied Throughout

----------------------------------------------------------------------------------------

========================================================================================
1. SCOPE AND READING GUIDE
========================================================================================

This document specifies the persistent data model for eight capability areas. Three of
them already exist in code and are extended, not replaced; five are new.

  # | Capability                   | Existing today               | This design
  --+------------------------------+------------------------------+-----------------------------
  1 | Authentication &             | users, sessions,             | Unchanged core + additive
    | Authorization                | service_credentials,         | fine-grained RBAC (§5)
    |                              | password_reset_codes         |
  2 | System-data management       | system_settings,             | Extended: setting metadata +
    |                              | smtp_configs, imap_configs,  | revisions, structured event
    |                              | integration_credentials,     | log, feature flags,
    |                              | system_audit_log             | retention policies (§6)
  3 | User management              | users (auth-shaped only)     | New: profiles, preferences,
    |                              |                              | activity log (§7)
  4 | Project management           | --                           | New: projects, members,
    |                              |                              | goals, milestones, tasks,
    |                              |                              | dependencies, time entries,
    |                              |                              | links (§10)
  5 | Knowledge management         | files + documents search     | New: knowledge, type,
    |                              | collection                   | category, tags, access
    |                              |                              | control (§9)
  6 | Notification management      | MailerService + smtp_configs | New: event types, templates,
    |                              | only                         | preferences, outbox,
    |                              |                              | suppressions (§11)
  7 | Human relationship           | --                           | New: contacts, channels,
    | management (CRM)             |                              | companies, types,
    |                              |                              | categories, tags,
    |                              |                              | relationships, interactions
    |                              |                              | (§8)
  8 | Financial management         | --                           | New: accounts, categories,
    |                              |                              | budgets, transactions,
    |                              |                              | recurring income/expense,
    |                              |                              | invoices, payments (§12)

Scope note on financial management. The goal statement's headline listed financial
management while the numbered requirements omitted it, so it was designed under a stated
assumption and then confirmed: operational finance -- budgets, spending, income,
invoicing -- not statutory double-entry bookkeeping (Q2, §15). Income is tracked as a
first-class axis alongside spending; see §12.

Scope note on knowledge management. Requirement 5 says the knowledge set will "only
include" five tables. Those five are exactly as specified (§9.1-§9.5). Two things sit
beside them: the shared tags vocabulary that knowledge_tags must join to (§4.3), and
knowledge_contact_links (§9.6), added on review so knowledge can reference contacts.
Revision history was considered and declined (Q3).

----------------------------------------------------------------------------------------

========================================================================================
2. CONVENTIONS INHERITED FROM THE EXISTING SCHEMA
========================================================================================

The new modules adopt the conventions already proven in
api/src/infrastructure/database/schema/. These are not new rules -- they are the ones
the current code already enforces, restated so the new tables cannot drift from them.

2.1 baseColumns and soft delete
-------------------------------

Every mutable business entity spreads baseColumns from common.ts: id uuid PK default
random, created_at, updated_at (auto-touched), is_deleted boolean, deleted_at.

deleted_at is a real deletion marker (null = live), never a second updated_at.

Append-only tables deliberately do NOT use baseColumns -- they carry only id +
created_at, following system_audit_log, agent_action_log and password_reset_codes. A log
row that can be soft-deleted is not an audit trail. In this design that applies to:
activity_log, system_event_log, notification_delivery_attempts,
system_setting_revisions.

2.2 Uniqueness under soft delete
--------------------------------

Every business-key unique index is partial, filtered on live rows, so a soft-deleted row
never blocks re-creation of the same key:

    [ ts ]
    uniqueIndex('projects_key_idx').on(t.key).where(sql`${t.isDeleted} = false`)

2.3 Enums vs lookup tables
--------------------------

  - pgEnum for closed vocabularies the code branches on (status machines, kinds,
    effects). Compile-time safe; changing one is a migration, which is correct for
    values with code behind them.
  - Lookup tables for open vocabularies the user curates (knowledge_type, contact_type,
    categories, tags). Rows carry a stable key slug plus is_system so code can reference
    a seeded row by key without hard-coding an id, and admins can add rows without a
    deploy.

Requirements 5 and 7 name knowledge_type, knowledge_category, contact_type,
contact_category explicitly as tables, which matches this rule.

2.4 JSONB discipline
--------------------

jsonb ... .$type<T>().notNull().default({}) for open extension bags (metadata), typed
payloads (FieldSpec[], EmailAddress[]) and settings values. JSONB is never used for data
that is filtered, joined or aggregated at scale -- that gets a column. Every metadata
column is documented as "non-authoritative; nothing in the query path may depend on it."

2.5 Secrets
-----------

Secrets live only in the dedicated *_configs / integration_credentials tables as
encrypted envelopes (secret_enc), or as one-way hashes (password_hash, token_hash,
key_hash, code_hash). No new table in this design stores a secret. system_settings
remains non-secret by design, and that invariant is restated in §6.1.

2.6 Principal-aware ownership
-----------------------------

common/principal.ts defines a discriminated union: user | service | system | anonymous.
The rules that bind this design:

  - Any column referencing users.id is populated only via userIdOrNull(principal) /
    requireUserId(principal). A service_credentials.id must never land in a users FK.
  - owner_user_id is nullable wherever a service or system principal can legitimately
    create the row (ingest pipelines, schedulers, agent tools) and non-nullable where a
    human owner is a domain invariant. Each table below states which, and why.
  - isAdmin(principal) is false for system. System pipelines get read privilege, not
    admin rights.

2.7 Postgres is the source of truth; Meilisearch is a rebuildable read model
----------------------------------------------------------------------------

Searchable entities are projected into search_records (collection + document + checksum
+ index_state outbox marker) and reconciled by the existing sweeps. No new table
duplicates Meilisearch state. §13 gives the projection map.

2.8 Naming
----------

snake_case table and column names in SQL; camelCase in Drizzle/TS. Tables are
singular-domain, plural-entity matching what exists (users, files, email_messages,
agent_run -- the design uses plural for all new tables and does not retro-rename
existing ones). Indexes are <table>_<purpose>_idx. FKs are <referenced_singular>_id.

2.9 File layout
---------------

One schema file per bounded context, all re-exported from schema/index.ts so drizzle-kit
and the typed db see the whole schema. api/CLAUDE.md caps files at 500 lines, so
contexts split:

    schema/
      common.ts                 (exists)  baseColumns
      identity.schema.ts        (exists)  users, sessions, service_credentials
      system.schema.ts          (exists)  settings, smtp/imap, integration credentials, audit
      file.schema.ts            (exists)  files
      search.schema.ts          (exists)  collections, search_records
      mailbox.schema.ts         (exists)  email_messages, attachments, sync state
      agent.schema.ts           (exists)  agent conversations, runs, approvals, schedules
      shared.schema.ts          (new)     tags, comments, entity_attachments, activity_log
      rbac.schema.ts            (new)     roles, permissions, grants
      profile.schema.ts         (new)     user_profiles, user_preferences
      contact.schema.ts         (new)     CRM
      knowledge.schema.ts       (new)     knowledge + vocabularies + ACL
      project.schema.ts         (new)     projects, tasks, goals, milestones
      project-link.schema.ts    (new)     cross-context links + time entries
      notification.schema.ts    (new)     templates, prefs, outbox
      finance.schema.ts         (new)     accounts, transactions, invoices

----------------------------------------------------------------------------------------

========================================================================================
3. DOMAIN MAP
========================================================================================

    [ diagram -- mermaid source ]
    graph TB
      subgraph Platform["Platform (exists)"]
        ID[Identity & Auth]
        SYS[System Data]
        FILE[Files / MinIO]
        SRCH[Search read model]
        MAIL[Mailbox / IMAP]
        AGT[Agent runtime]
      end

      subgraph Core["New capability modules"]
        RBAC[Authorization / RBAC]
        USR[User Management]
        CRM[Human Relationships]
        KB[Knowledge]
        PRJ[Project Management]
        NOTIF[Notifications]
        FIN[Financial]
      end

      SHARED[Cross-cutting: tags, comments, attachments, activity_log]

      ID --> RBAC --> PRJ
      ID --> USR --> NOTIF
      USR --> PRJ
      PRJ --> KB
      PRJ --> CRM
      PRJ --> FIN
      CRM --> FIN
      CRM --> MAIL
      KB --> FILE
      FIN --> FILE
      SHARED -.-> KB
      SHARED -.-> PRJ
      SHARED -.-> CRM
      KB --> SRCH
      PRJ --> SRCH
      CRM --> SRCH
      NOTIF --> SYS
      AGT --> PRJ

Dependency direction is acyclic and deliberate. Identity has no outbound dependency on
any new module. Projects depend on knowledge and CRM (references), never the reverse.
Finance depends on projects and CRM, never the reverse. This is what lets the phase plan
in §14 ship one module at a time without a big-bang migration.

----------------------------------------------------------------------------------------

========================================================================================
4. CROSS-CUTTING DESIGN DECISIONS
========================================================================================

These decisions are made once and applied everywhere. They are the highest-leverage part
of the design: getting them wrong duplicates five near-identical tables per module.

4.1 Tagging: one vocabulary, per-domain joins
---------------------------------------------

Decision. A single shared tags table holds the vocabulary. Each domain gets its own
explicit join table (knowledge_tags, contact_tags, project_tags, task_tags).

Why not a single polymorphic taggings(entity_type, entity_id, tag_id)? It cannot carry a
foreign key, so a deleted knowledge row silently orphans its taggings, and every read
needs a type discriminator in the predicate. Explicit joins are FK-enforced, index
cleanly on both sides, and cost one four-column table each.

Why not per-domain tag vocabularies? Because "urgent" would then exist as three
unrelated rows with three ids, and a cross-domain search facet ("everything tagged
acquisition") becomes a three-way union. One vocabulary with a scope column gives both:
scoped autocomplete in the UI, unified facets in search.

4.2 Controlled polymorphism -- and where it is banned
-----------------------------------------------------

Two cross-cutting concerns genuinely have no per-pair semantics and an identical shape
everywhere: comments and file attachments. Those get one generic table each, keyed by
(entity_type, entity_id) where entity_type is a pgEnum (not free text) and there is no
FK.

Everything else uses explicit join tables. Specifically, project_knowledge_links and
project_contact_links are explicit because they carry relationship semantics
(relationship, relevance, note) that a generic linker would push into JSONB and out of
the query path.

The cost is stated plainly: generic tables need application-level cascade on delete of
the parent entity, and cannot be validated by the database. The entity_type enum plus a
documented cascade helper (deleteEntityGraph(entityType, entityId, tx)) is the
mitigation. This is accepted for two tables and refused for the rest.

4.3 tags
--------

  Column         | Type             | Notes
  ---------------+------------------+-----------------------------------------------------------
  ...baseColumns |                  |
  key            | varchar(80)      | Slug, lowercased. Unique per scope among live rows.
  label          | varchar(120)     | Display form.
  scope          | tag_scope enum   | knowledge, contact, project, task, shared. shared is
                 |                  | usable everywhere.
  color          | varchar(16)      | Optional UI hint.
  description    | varchar(500)     |
  usage_count    | integer          | Denormalized; maintained by the tag service, rebuildable
                 |                  | by a sweep. Facet ordering only -- never authoritative.
  created_by     | uuid -> users.id | Nullable (service/system may seed tags).
  is_system      | boolean          | Seeded vocabulary; blocks user deletion.

    [ ts ]
    uniqueIndex('tags_scope_key_idx').on(t.scope, t.key).where(sql`${t.isDeleted} = false`)
    index('tags_scope_usage_idx').on(t.scope, t.usageCount)

Join tables all share this shape (shown once, for knowledge_tags):

  Column         | Type                          | Notes
  ---------------+-------------------------------+----------------------------------------------
  ...baseColumns |                               | Soft delete keeps "tag was removed at T"
                 |                               | auditable.
  knowledge_id   | uuid -> knowledge.id NOT NULL | onDelete: cascade
  tag_id         | uuid -> tags.id NOT NULL      | onDelete: cascade
  tagged_by      | uuid -> users.id              | Nullable -- agents tag too.

    [ ts ]
    uniqueIndex('knowledge_tags_pair_idx').on(t.knowledgeId, t.tagId).where(sql`${t.isDeleted} = false`)
    index('knowledge_tags_tag_idx').on(t.tagId)   // reverse lookup: "everything tagged X"

contact_tags, project_tags, task_tags are identical with their own FK column.

4.4 comments
------------

  Column            | Type                  | Notes
  ------------------+-----------------------+---------------------------------------------------
  ...baseColumns    |                       | Soft delete: a removed comment leaves a tombstone
                    |                       | in the thread.
  entity_type       | commentable_type enum | project, task, goal, milestone, knowledge,
                    |                       | contact, invoice
  entity_id         | uuid NOT NULL         | No FK -- see §4.2.
  parent_comment_id | uuid -> comments.id   | One level of threading enforced in the service.
  author_user_id    | uuid -> users.id      | Nullable: agent-authored comments exist;
                    |                       | author_kind disambiguates.
  author_kind       | actor_kind enum       | user, service, system -- the acting arms of
                    |                       | common/principal.ts.
  body              | text NOT NULL         | Markdown.
  mentions          | jsonb string[]        | Resolved users.id list; drives notifications.
                    |                       | Written by the service, never by the client.
  edited_at         | timestamptz           |

    [ ts ]
    index('comments_entity_idx').on(t.entityType, t.entityId, t.createdAt)
    index('comments_author_idx').on(t.authorUserId)

4.5 entity_attachments
----------------------

Binds any entity to a row in the existing files table. This is what serves requirement
4's "project-related documents" -- there is no separate project_documents table.

  Column         | Type                      | Notes
  ---------------+---------------------------+--------------------------------------------------
  ...baseColumns |                           |
  entity_type    | attachable_type enum      | project, task, knowledge, contact,
                 |                           | contact_company, invoice, transaction
  entity_id      | uuid NOT NULL             | No FK -- see §4.2.
  file_id        | uuid -> files.id NOT NULL | The bytes live in MinIO; files owns lifecycle +
                 |                           | checksum.
  label          | varchar(255)              | Human caption.
  kind           | attachment_kind enum      | document, image, receipt, contract, other --
                 |                           | drives UI grouping.
  attached_by    | uuid -> users.id          | Nullable.
  sort_order     | integer                   |

    [ ts ]
    uniqueIndex('entity_attachments_unique_idx')
      .on(t.entityType, t.entityId, t.fileId).where(sql`${t.isDeleted} = false`)
    index('entity_attachments_entity_idx').on(t.entityType, t.entityId)
    index('entity_attachments_file_idx').on(t.fileId)   // "what references this file?" before purge

Why the file_id reverse index matters: the orphaned-upload sweep must be able to answer
"is this file still referenced?" without a full scan across seven tables.

4.6 activity_log -- and how it differs from system_audit_log
------------------------------------------------------------

Both exist on purpose. Merging them would force one retention policy and one access rule
onto two very different data sets.

                      | system_audit_log (exists)          | activity_log (new)
  --------------------+------------------------------------+------------------------------------
  Question it answers | "Who changed system                | "What happened on this project / to
                      | configuration?"                    | this record?"
  Audience            | Compliance, admins                 | End users (activity feeds), plus
                      |                                    | support
  Volume              | Tens of rows/day                   | Thousands of rows/day
  Content             | Changed field names only, redacted | Before/after values for business
                      |                                    | fields
  Retention           | Long (years)                       | Bounded, policy-driven (§6.4)
  Read scope          | Admin only                         | Whoever may read the subject entity

activity_log -- append-only, no baseColumns:

  Column              | Type                               | Notes
  --------------------+------------------------------------+------------------------------------
  id                  | uuid PK                            |
  created_at          | timestamptz NOT NULL               | Retention key; indexed for the
                      |                                    | purge sweep (§4.7).
  actor_user_id       | uuid -> users.id                   | Nullable.
  actor_kind          | actor_kind enum NOT NULL           | Distinguishes agent/system action
                      |                                    | from human. Named actor_kind, not
                      |                                    | principal_kind, because it carries
                      |                                    | only the three arms that can act
                      |                                    | (user, service, system) -- an
                      |                                    | anonymous caller cannot produce an
                      |                                    | activity row.
  actor_credential_id | uuid -> service_credentials.id     | Set when actor_kind = 'service'.
                      |                                    | Keeps machine ids out of the users
                      |                                    | FK, per §2.6.
  entity_type         | activity_entity_type enum NOT NULL |
  entity_id           | uuid                               |
  action              | varchar(100) NOT NULL              | task.status_changed,
                      |                                    | knowledge.published, ...
  summary             | varchar(500)                       | Pre-rendered feed line.
  changes             | jsonb                              | { field: { from, to } }. Business
                      |                                    | fields only -- never secrets,
                      |                                    | hashes or tokens.
  project_id          | uuid -> projects.id                | Denormalized scope key so a project
                      |                                    | feed is one index scan, not a
                      |                                    | per-type union.
  request_id          | varchar(64)                        | Correlates with application logs.
  ip / user_agent     | varchar(45) / varchar(512)         | Mirrors system_audit_log.

    [ ts ]
    index('activity_log_entity_idx').on(t.entityType, t.entityId, t.createdAt)
    index('activity_log_project_idx').on(t.projectId, t.createdAt)
    index('activity_log_actor_idx').on(t.actorUserId, t.createdAt)

4.7 Growth strategy for high-volume tables
------------------------------------------

Three tables are unbounded by design: activity_log, system_event_log, notifications (+
notification_delivery_attempts).

Decision (revised after Q6): they ship as ordinary heap tables with a created_at index,
and partitioning is deferred.

The original recommendation was to partition monthly from day one. What changed is the
retention answer: a uniform 120-day window on every governed table (§6.4) bounds all
four at roughly a quarter of their arrival rate, and a DELETE ... WHERE created_at <
now() - interval '120 days' against *_created_idx is adequate at that size. Partitioning
also costs a hand-written migration per table, because drizzle-kit cannot generate
partitioned DDL and the resulting tables would then disagree with its snapshot.

The deferral is not free, and the trigger for revisiting it is explicit: when any of
these tables exceeds roughly 10 million live rows, or when a retention purge starts
taking longer than its scheduling interval, convert to PARTITION BY RANGE (created_at)
and switch the purge to DETACH + DROP. Converting a large heap table later requires a
rewrite under lock, so this is a threshold to watch rather than a decision to forget.

4.8 Money representation
------------------------

  - Amounts: numeric(20, 4). Never float/double. Four decimals absorbs unit prices and
    FX without premature rounding; presentation rounds to the currency's minor unit.
  - Every amount column is accompanied by a currency varchar(3) (ISO-4217) on the same
    row. There is no implicit currency.
  - Every row that can be cross-currency also stores base_amount + fx_rate + fx_rate_at,
    so reporting never re-derives history from today's rates.
  - Amounts are immutable once a transaction reaches cleared; corrections are reversing
    entries.

4.9 Ordering of user-sortable lists
-----------------------------------

Tasks, milestones and checklist-like lists need drag-and-drop ordering. Using integer
sort_order forces an O(n) rewrite of the list on every move.

Decision: sort_rank varchar(64) holding a lexicographic rank (LexoRank-style). A move
writes exactly one row. A rebalance sweep runs only when ranks collide. Where ordering
is admin-only and lists are short (contact_types, knowledge_categories), plain integer
sort_order is fine and is what those tables use.

----------------------------------------------------------------------------------------

========================================================================================
5. AUTHENTICATION & AUTHORIZATION
========================================================================================

5.1 What stays exactly as it is
-------------------------------

users, sessions, service_credentials, password_reset_codes are unchanged. The token
lifecycle -- argon2id password hashing, opaque refresh tokens stored as sha256,
family_id rotation lineage with theft response, the sid claim making access tokens
revocable, and the TokenValidityService / SessionCacheService revocation path -- is the
authentication mechanism this design builds on. No new table participates in
authentication.

5.2 The authorization problem to solve
--------------------------------------

Today authorization is a single coarse axis: users.role in {guest, user, admin, agent},
signed into the JWT, checked by RolesGuard against @Roles(...), with row-level scoping
done ad hoc per feature (resolveReadScope for search, ownership checks in FileService).

That is sufficient for the current surface and insufficient for projects and knowledge,
where "can this person edit this task" depends on membership in a project, not on a
global role.

5.3 The three-layer model
-------------------------

    [ diagram -- mermaid source ]
    graph LR
      A["Layer 1: Role gate<br/>@Roles + RolesGuard<br/>(unchanged, from JWT)"]
      B["Layer 2: Permission check<br/>roles/permissions tables<br/>(server-side, cached)"]
      C["Layer 3: Row scope<br/>ownership + membership + ACL<br/>(per-module tables)"]
      A --> B --> C

  Layer | Question                     | Enforced by                   | Source
  ------+------------------------------+-------------------------------+------------------------
  1     | Is this caller kind allowed  | RolesGuard                    | role claim in JWT
        | on this route at all?        |                               |
  2     | Does this caller hold        | new PermissionsGuard          | DB + Redis cache
        | permission                   |                               |
        | project.task.update?         |                               |
  3     | On this row?                 | Service-layer scope resolvers | membership / ACL tables

Four invariants that make this additive rather than a rewrite:

  1. users.role stays authoritative for layer 1. It remains the JWT claim. The roles
     table is seeded with rows whose key matches the enum values, so the two
     vocabularies cannot diverge.
  2. Permissions are never put in the JWT. A token lives for its full TTL; a permission
     revoked mid-session must take effect immediately. Permissions are resolved
     server-side per request from a Redis-cached set keyed by user:{id}:perms,
     invalidated on any grant change via the same pub/sub invalidation pattern
     IndexRegistry and SessionCacheService already use.
  3. admin is a superuser short-circuit. isAdmin(principal) returns before any
     permission lookup. The RBAC layer only ever grants -- it can never take a
     capability away from an admin. This keeps the existing admin surface exactly as it
     behaves today.
  4. A route with no permission requirement behaves as it does today. Adoption is
     per-route.

5.4 permissions
---------------

The catalog of capabilities. Seeded from code, is_system = true, not user-editable.

  Column         | Type                 | Notes
  ---------------+----------------------+-------------------------------------------------------
  ...baseColumns |                      |
  key            | varchar(120)         | <resource>.<action>, e.g. project.task.update. Unique
                 |                      | among live rows.
  resource       | varchar(60) NOT NULL | project, knowledge, contact, finance, system.
  action         | varchar(40) NOT NULL | create, read, update, delete, manage, approve, export.
  description    | varchar(500)         | Rendered in the admin UI.
  is_system      | boolean              | Always true for seeded rows; blocks deletion.

    [ ts ]
    uniqueIndex('permissions_key_idx').on(t.key).where(sql`${t.isDeleted} = false`)
    index('permissions_resource_idx').on(t.resource)

A boot-time assertion -- mirroring assertEveryRouteDeclaresPolicy, which already refuses
to start an app with an undeclared route -- verifies that every @RequirePermission('x')
in the codebase resolves to a seeded row. A typo in a permission string becomes a boot
failure, not a silent deny.

5.5 roles
---------

  Column         | Type                  | Notes
  ---------------+-----------------------+------------------------------------------------------
  ...baseColumns |                       |
  key            | varchar(60)           | Unique live. Seeded with user, admin, agent to mirror
                 |                       | the user_role enum, plus curated roles
                 |                       | (project_manager, knowledge_editor, finance_viewer).
  name           | varchar(120) NOT NULL |
  description    | varchar(500)          |
  is_system      | boolean               | Mirror rows and seeded roles: immutable key,
                 |                       | undeletable.
  priority       | integer               | Display order and tie-break only. Not a privilege
                 |                       | ladder -- permissions are a set union, never a
                 |                       | hierarchy (see §5.9).

5.6 role_permissions
--------------------

  Column         | Type                            | Notes
  ---------------+---------------------------------+--------------------------
  ...baseColumns |                                 |
  role_id        | uuid -> roles.id NOT NULL       | cascade
  permission_id  | uuid -> permissions.id NOT NULL | cascade
  granted_by     | uuid -> users.id                | Nullable for seeded rows.

    [ ts ]
    uniqueIndex('role_permissions_pair_idx').on(t.roleId, t.permissionId).where(sql`${t.isDeleted} = false`)
    index('role_permissions_role_idx').on(t.roleId)

5.7 user_roles
--------------

  Column         | Type                      | Notes
  ---------------+---------------------------+--------------------------------------------------
  ...baseColumns |                           |
  user_id        | uuid -> users.id NOT NULL | cascade
  role_id        | uuid -> roles.id NOT NULL | cascade
  granted_by     | uuid -> users.id          |
  expires_at     | timestamptz               | Time-boxed elevation. Null = permanent. A cleanup
                 |                           | scheduler expires them, and the resolver also
                 |                           | filters on expires_at at read time so a stalled
                 |                           | scheduler cannot leave privilege standing.

    [ ts ]
    uniqueIndex('user_roles_pair_idx').on(t.userId, t.roleId).where(sql`${t.isDeleted} = false`)
    index('user_roles_user_idx').on(t.userId)
    index('user_roles_expiring_idx').on(t.expiresAt).where(sql`${t.expiresAt} IS NOT NULL`)

5.8 user_permissions (per-user exception -- optional, phase 2)
--------------------------------------------------------------

  Column         | Type                            | Notes
  ---------------+---------------------------------+--------------------------------------------
  ...baseColumns |                                 |
  user_id        | uuid -> users.id NOT NULL       |
  permission_id  | uuid -> permissions.id NOT NULL |
  effect         | permission_effect enum NOT NULL | allow, deny
  reason         | varchar(500) NOT NULL           | Required. An exception without a recorded
                 |                                 | reason becomes permanent by amnesia.
  granted_by     | uuid -> users.id                |
  expires_at     | timestamptz                     |

Ship this only when a concrete need appears. Per-user exceptions are the part of every
RBAC system that becomes unauditable first.

5.9 Resolution algorithm (single implementation, PermissionResolver)
--------------------------------------------------------------------

    effectivePermissions(user):
      if user.role == 'admin':            return ALL          # layer-1 short-circuit, no lookup
      granted = UNION { role_permissions[r] : r in live, unexpired user_roles(user) }
      granted += { p : user_permissions(user, effect='allow', unexpired) }
      granted -= { p : user_permissions(user, effect='deny',  unexpired) }   # deny always wins
      return granted

Cached in Redis at perm:user:{id} with the same TTL-plus-invalidation discipline as the
session cache. Every write to user_roles, role_permissions, user_permissions or
users.role publishes an invalidation; a role edit invalidates every member of that role.

Deny wins, and precedence is not order-dependent -- set union then set difference gives
the same answer regardless of evaluation order. Ordered rule lists are where RBAC
systems become impossible to reason about.

5.10 Row-level scope (layer 3) by module
----------------------------------------

Layer 3 is not one mechanism; it is one pattern applied three ways, each already
precedented in the codebase:

  Module       | Mechanism                              | Precedent
  -------------+----------------------------------------+---------------------------------------
  Projects     | project_members row for (project,      | new, but the shape of resolveReadScope
               | user) + role_in_project                |
  Knowledge    | knowledge_access_control grants,       | resolveReadScope truth table
               | grant-only                             |
  CRM          | contacts.owner_user_id + a shared      | FileService ownership
               | visibility flag                        |
  Search reads | resolveReadScope(collection,           | exists, unchanged
               | principal)                             |

Each returns data, not exceptions -- a resolved scope object the caller turns into a SQL
predicate or a Meili filter, exactly as ReadScope does today. That is what makes the
truth table exhaustively testable and keeps two call sites from diverging.

----------------------------------------------------------------------------------------

========================================================================================
6. SYSTEM-DATA MANAGEMENT
========================================================================================

6.1 system_settings -- extensions
---------------------------------

The existing table (key, value_json, type, category, description) is sound. Five
additive columns, all nullable or defaulted, so the migration needs no backfill:

  New column      | Type                 | Why
  ----------------+----------------------+------------------------------------------------------
  is_editable     | boolean default true | Settings written by bootstrap/migration that an admin
                  |                      | must not edit through the UI.
  default_json    | jsonb                | Enables "reset to default" and shows drift from
                  |                      | shipped defaults.
  validation_json | jsonb                | JSON-Schema fragment validated on write. Today a bad
                  |                      | value is only discovered by the consumer at runtime.
  updated_by      | uuid -> users.id     | Who last changed it. Currently only inferable from
                  |                      | system_audit_log.
  version         | integer default 0    | Optimistic concurrency: two admins editing the same
                  |                      | setting no longer silently overwrite.

Unchanged invariant: system_settings holds non-secret values only. Secrets belong in
smtp_configs.secret_enc, imap_configs.secret_enc, integration_credentials.secret_enc.
The validation_json mechanism must not be used to smuggle credential shapes in.

6.2 system_setting_revisions (new, append-only)
-----------------------------------------------

system_audit_log.metadata deliberately records changed field names only, because it also
covers secret-bearing tables. For non-secret settings the old and new values are exactly
what an operator needs during an incident.

  Column                        | Type                          | Notes
  ------------------------------+-------------------------------+-------------------------------
  id                            | uuid PK                       |
  created_at                    | timestamptz NOT NULL          |
  setting_id                    | uuid -> system_settings.id    |
                                | NOT NULL                      |
  key                           | varchar(150) NOT NULL         | Denormalized so history
                                |                               | survives a setting's deletion.
  old_value_json /              | jsonb                         | Full values. Safe because this
  new_value_json                |                               | table covers system_settings
                                |                               | only, which is non-secret by
                                |                               | §6.1.
  changed_by                    | uuid -> users.id              |
  reason                        | varchar(500)                  |

    [ ts ]
    index('system_setting_revisions_setting_idx').on(t.settingId, t.createdAt)

6.3 system_event_log (new, append-only, partitioned) -- and what does not go in it
----------------------------------------------------------------------------------

Application logs do not belong in Postgres. Request logs, stack traces and debug output
go to stdout and the log shipper, where they are cheap, searchable and rotated. Putting
them in the database buys nothing and costs write throughput, disk and vacuum pressure.

What does belong is a small, structured stream of domain events an operator must be able
to query transactionally and join to business rows: a scheduler sweep's outcome, an
integration failure, a quota breach, a retention purge.

  Column                  | Type                         | Notes
  ------------------------+------------------------------+--------------------------------------
  id                      | uuid PK                      |
  created_at              | timestamptz NOT NULL         | Partition key, monthly.
  severity                | event_severity enum NOT NULL | debug, info, warn, error, critical
  source                  | varchar(100) NOT NULL        | Emitting component, e.g.
                          |                              | search-indexing.processor.
  event_key               | varchar(120) NOT NULL        | Stable machine key, e.g.
                          |                              | search.reconcile.completed.
  message                 | varchar(1000) NOT NULL       |
  payload                 | jsonb                        | Structured detail. Redacted by the
                          |                              | same helper system_audit_log uses.
  entity_type / entity_id | enum / uuid                  | Optional subject.
  correlation_id          | varchar(64)                  | Ties to request logs and BullMQ job
                          |                              | ids.
  duration_ms             | integer                      | For sweep/job events.

    [ ts ]
    index('system_event_log_severity_idx').on(t.severity, t.createdAt)
    index('system_event_log_key_idx').on(t.eventKey, t.createdAt)
    index('system_event_log_correlation_idx').on(t.correlationId)

Emission rule: severity >= warn, or an event with an explicit operator consumer.
Anything else is a logger call.

6.4 data_retention_policies (new)
---------------------------------

Retention is currently implicit and per-feature (the search purge sweep,
auth-cleanup.scheduler). This table makes it declarative and auditable in one place.

  Column                        | Type                          | Notes
  ------------------------------+-------------------------------+-------------------------------
  ...baseColumns                |                               |
  entity_type                   | retention_entity_type enum    | activity_log,
                                | NOT NULL                      | system_event_log,
                                |                               | notifications, notification_de
                                |                               | livery_attempts, sessions,
                                |                               | password_reset_codes,
                                |                               | email_messages, search_records
  retention_days                | integer NOT NULL              |
  action                        | retention_action enum NOT     | purge (delete), anonymize
                                | NULL                          | (null out PII, keep the row),
                                |                               | archive (export then drop
                                |                               | partition)
  enabled                       | boolean default true          |
  last_run_at / last_run_status |                               | Observability for the sweep.
  / last_deleted_count          |                               |

    [ ts ]
    uniqueIndex('data_retention_entity_idx').on(t.entityType).where(sql`${t.isDeleted} = false`)

A single RetentionScheduler reads this table, so adding a retention rule is a row, not a
scheduler. The action is a bounded DELETE against each table's created_at index. Should
any of these grow past the threshold in §4.7, the same policy row drives DETACH + DROP
of whole partitions instead -- orders of magnitude cheaper -- without the rule itself
changing.

6.5 feature_flags (new)
-----------------------

  Column         | Type                  | Notes
  ---------------+-----------------------+------------------------------------------------------
  ...baseColumns |                       |
  key            | varchar(120)          | Unique live.
  description    | varchar(500)          |
  enabled        | boolean default false | Global kill switch.
  rollout        | jsonb                 | { userIds?: string[], roles?: string[], percentage?:
                 |                       | number }.
  expires_at     | timestamptz           | A flag with no expiry becomes permanent config.
                 |                       | Nudges cleanup.

This design adds seven modules across six phases; each phase's routes ship behind a flag
so a bad migration is a toggle away from being contained rather than a rollback.

6.6 Unchanged
-------------

smtp_configs, imap_configs (single-active partial unique index), integration_credentials
(unique (provider, name) live, encrypted secret_enc, non-secret meta) and
system_audit_log are correct as they stand and are not modified.

----------------------------------------------------------------------------------------

========================================================================================
7. USER MANAGEMENT
========================================================================================

7.1 Why users is not extended in place
--------------------------------------

users is on the hot authentication path: every login and every JwtStrategy.validate
reads it. It carries exactly what authentication needs -- email, password_hash, role,
display_name, last_login_at -- and is indexed accordingly.

Profile data is wide, rarely read on the auth path, mostly nullable, and PII-dense.
Widening users with fifteen profile columns would put avatar URLs and phone numbers into
every token validation, and would scatter the fields a GDPR export or erasure request
must cover.

Decision: a 1:1 user_profiles table, created lazily on first profile write (not on
signup), so users stays exactly as it is.

7.2 user_profiles
-----------------

  Column                    | Type                      | Notes
  --------------------------+---------------------------+---------------------------------------
  ...baseColumns            |                           |
  user_id                   | uuid -> users.id NOT NULL | cascade. Unique live -> enforces 1:1.
  first_name / last_name    | varchar(120)              | users.display_name remains the
                            |                           | denormalized display form used by the
                            |                           | auth layer.
  avatar_file_id            | uuid -> files.id          | Reuses MinIO + the existing
                            |                           | quarantine/checksum lifecycle rather
                            |                           | than a URL column.
  job_title                 | varchar(150)              |
  department                | varchar(150)              |
  phone                     | varchar(40)               |
  timezone                  | varchar(64) default 'UTC' | IANA zone. Read by the notification
                            |                           | scheduler for quiet hours and digest
                            |                           | windows.
  locale                    | varchar(16) default 'en'  | Selects the notification_templates row
                            |                           | (§11.3).
  date_format / time_format | varchar(32)               | UI preference.
  bio                       | varchar(2000)             |
  contact_id                | uuid -> contacts.id       | Optional back-link when a staff member
                            |                           | is also a CRM contact. Nullable; CRM
                            |                           | is an independent module.
  onboarded_at              | timestamptz               |
  metadata                  | jsonb                     |

    [ ts ]
    uniqueIndex('user_profiles_user_idx').on(t.userId).where(sql`${t.isDeleted} = false`)

PII register. user_profiles, contacts, contact_channels, email_messages and
activity_log.ip are the PII-bearing tables. An erasure request anonymizes these five and
nothing else -- recording that here is what makes the request answerable in minutes.

7.3 user_preferences
--------------------

Mirrors the system_settings shape deliberately, so one typed read/validate helper serves
both.

  Column         | Type                      | Notes
  ---------------+---------------------------+------------------------------------------------
  ...baseColumns |                           |
  user_id        | uuid -> users.id NOT NULL | cascade
  key            | varchar(150) NOT NULL     |
  value_json     | jsonb NOT NULL            |
  type           | setting_type enum         | Reuses the existing enum from system.schema.ts.

    [ ts ]
    uniqueIndex('user_preferences_user_key_idx').on(t.userId, t.key).where(sql`${t.isDeleted} = false`)

Resolution order for any preference: user_preferences -> system_settings (default_json)
-> compiled-in default.

Notification preferences are not stored here. They are structured, queried in bulk by
the send path ("who wants task.assigned by email?"), and get their own table (§11.4). A
key/value bag cannot serve that query without a JSONB scan per recipient.

7.4 Teams -- deliberately not built
-----------------------------------

An earlier draft included teams + team_members as a membership shortcut. Removed on
review.

The argument for them was administrative: without teams, adding a person to twelve
projects is twelve project_members rows. The argument against is that a second
membership mechanism means every access check must consult two sources, and "why can
this person see this project?" acquires an answer that is not visible on the project
itself. For a single-tenant deployment (Q1) the administrative saving does not pay for
that.

Consequences, applied throughout this document: projects has no team_id, grantee_type
has no team arm, and resolveProjectScope has no team branch. If teams are wanted later
they are additive -- a table, a grantee arm, and one clause in each resolver -- and
nothing here forecloses them.

7.5 User activity
-----------------

Covered by the shared activity_log (§4.6). No separate user_activity_log: a user's
activity feed is activity_log WHERE actor_user_id = ?, served by activity_log_actor_idx.

----------------------------------------------------------------------------------------

========================================================================================
8. HUMAN RELATIONSHIP MANAGEMENT (CRM)
========================================================================================

8.1 Requirement mapping
-----------------------

Requirement 7 names five stores. This is how they map, so nothing is silently renamed:

  Requirement          | Table(s) here               | Note
  ---------------------+-----------------------------+------------------------------------------
  contact_info         | contacts + contact_channels | One core record; multi-valued
                       |                             | emails/phones normalized out (§8.3).
  contact_type         | contact_types               | Lookup.
  contact_company_info | contact_companies           |
  contact_category     | contact_categories          | Hierarchical.
  contact_tags         | contact_tags -> tags        | Join to the shared vocabulary (§4.1).

Two additions beyond the listed five, flagged as such: contact_relationships (§8.7) and
contact_interactions (§8.8). "Human relationship management" without a relationship edge
or a touchpoint history is an address book; both are small tables and both are cheap to
omit if unwanted.

    [ diagram -- mermaid source ]
    erDiagram
      contact_companies ||--o{ contacts : employs
      contact_types     ||--o{ contacts : classifies
      contact_categories||--o{ contacts : segments
      contacts ||--o{ contact_channels : has
      contacts ||--o{ contact_tags : tagged
      tags     ||--o{ contact_tags : vocabulary
      contacts ||--o{ contact_relationships : from
      contacts ||--o{ contact_interactions : touchpoints
      users    ||--o{ contacts : owns
      email_messages ||--o{ contact_interactions : sources

8.2 contacts
------------

  Column                 | Type                          | Notes
  -----------------------+-------------------------------+--------------------------------------
  ...baseColumns         |                               |
  first_name / last_name | varchar(120)                  |
  display_name           | varchar(255) NOT NULL         | Stored, not computed: organizations
                         |                               | and mononyms break first + last, and
                         |                               | search projection needs one stable
                         |                               | field.
  salutation             | varchar(40)                   |
  primary_email          | varchar(320)                  | Denormalized from contact_channels
                         |                               | for list rendering; the channel row
                         |                               | is authoritative.
  email_normalized       | varchar(320)                  | Lowercased, trimmed primary_email.
                         |                               | Unique among live rows -- this is
                         |                               | what makes deduplication automatic
                         |                               | (see below).
  primary_phone          | varchar(40)                   | Same.
  job_title              | varchar(150)                  |
  company_id             | uuid -> contact_companies.id  | Nullable.
  type_id                | uuid -> contact_types.id      |
  category_id            | uuid -> contact_categories.id |
  owner_user_id          | uuid -> users.id              | The relationship owner. Nullable --
                         |                               | ingest pipelines create contacts from
                         |                               | inbound email under a system
                         |                               | principal (§2.6).
  linked_user_id         | uuid -> users.id              | Set when this contact is also a
                         |                               | system user. Unique live: one contact
                         |                               | per user.
  status                 | contact_status enum           | active, inactive, archived,
                         |                               | do_not_contact
  source                 | contact_source enum           | manual, inbound_email, import,
                         |                               | referral, website, agent --
                         |                               | provenance for data quality.
  visibility             | contact_visibility enum       | private (owner + admin), shared (all
                         |                               | authenticated users). Default
                         |                               | private, matching the fail-closed
                         |                               | default collections.visibility
                         |                               | already uses.
  address                | jsonb                         | { line1, line2, city, region,
                         |                               | postalCode, country }. JSONB because
                         |                               | addresses are displayed, not
                         |                               | filtered. country is duplicated to a
                         |                               | column where reporting needs it.
  country                | varchar(2)                    | ISO-3166-1 alpha-2. Filterable.
  timezone / language    | varchar(64) / varchar(16)     |
  birthday               | date                          | date, not timestamptz -- a birthday
                         |                               | has no time zone.
  notes                  | text                          |
  last_contacted_at      | timestamptz                   | Maintained from contact_interactions.
  next_follow_up_at      | timestamptz                   | Drives a follow-up notification
                         |                               | (§11).
  avatar_file_id         | uuid -> files.id              |
  metadata               | jsonb                         |

    [ ts ]
    index('contacts_owner_idx').on(t.ownerUserId).where(sql`${t.isDeleted} = false`)
    index('contacts_company_idx').on(t.companyId)
    index('contacts_email_idx').on(t.primaryEmail)        // deliberately NOT unique -- see below
    index('contacts_status_idx').on(t.status)
    index('contacts_follow_up_idx').on(t.nextFollowUpAt).where(sql`${t.nextFollowUpAt} IS NOT NULL`)
    uniqueIndex('contacts_linked_user_idx').on(t.linkedUserId)
      .where(sql`${t.linkedUserId} IS NOT NULL AND ${t.isDeleted} = false`)

Deduplication is automatic (Q5). email_normalized carries a partial unique index over
live rows, and every write path upserts against it: an inbound email, an import or an
agent meeting an address already on file updates that contact instead of creating a
twin. No human review step, and no duplicate-merge backlog.

The cost is stated rather than hidden. A shared address -- info@, a couple sharing an
account, a role mailbox -- now resolves to exactly one contact. Where two real people
genuinely share one address, the second is created with an empty primary_email and the
address recorded as a non-primary contact_channels row, which is unconstrained. Ingest
must therefore treat "contact already exists" as the normal path, not an error: ON
CONFLICT (email_normalized) WHERE is_deleted = false DO UPDATE rather than a bare
insert, or the pipeline fails on valid mail.

primary_email itself stays non-unique: it is a display denormalization, and constraining
both it and its normalized form would reject legitimate casing differences twice.

8.3 contact_channels
--------------------

  Column         | Type                               | Notes
  ---------------+------------------------------------+-----------------------------------------
  ...baseColumns |                                    |
  contact_id     | uuid -> contacts.id NOT NULL       | cascade
  kind           | contact_channel_kind enum NOT NULL | email, phone, mobile, fax, website,
                 |                                    | linkedin, twitter, wechat, whatsapp,
                 |                                    | other
  value          | varchar(320) NOT NULL              | Emails stored lowercased, matching
                 |                                    | users.email.
  label          | varchar(60)                        | work, home, ...
  is_primary     | boolean                            | At most one primary per (contact, kind).
  is_verified    | boolean                            |
  opted_out_at   | timestamptz                        | Channel-level opt-out; the notification
                 |                                    | send path checks it (§11.7).

    [ ts ]
    uniqueIndex('contact_channels_value_idx').on(t.contactId, t.kind, t.value)
      .where(sql`${t.isDeleted} = false`)
    uniqueIndex('contact_channels_primary_idx').on(t.contactId, t.kind)
      .where(sql`${t.isPrimary} = true AND ${t.isDeleted} = false`)
    index('contact_channels_value_lookup_idx').on(t.kind, t.value)   // inbound-email -> contact match

The last index is the one that makes CRM/mailbox integration work: an inbound
email_messages row's from_address resolves to a contact in a single index lookup.

8.4 contact_types
-----------------

  Column             | Type                        | Notes
  -------------------+-----------------------------+--------------------------------------------
  ...baseColumns     |                             |
  key                | varchar(60)                 | Unique live. Seeded: lead, prospect,
                     |                             | client, supplier, partner, employee,
                     |                             | advisor, other.
  name / description | varchar(120) / varchar(500) |
  color              | varchar(16)                 |
  sort_order         | integer                     | Admin-ordered short list -> plain integer
                     |                             | is fine (§4.9).
  is_system          | boolean                     | Seeded rows undeletable.

8.5 contact_categories
----------------------

Hierarchical segmentation (industry, region, relationship tier).

  Column             | Type                          | Notes
  -------------------+-------------------------------+------------------------------------------
  ...baseColumns     |                               |
  key                | varchar(60)                   | Unique live.
  name / description |                               |
  parent_id          | uuid -> contact_categories.id |
  path               | varchar(500) NOT NULL         | Materialized path /root/child/leaf,
                     |                               | maintained by the service.
  depth              | integer NOT NULL              | Capped (default 5) to bound rewrites.
  sort_order         | integer                       |
  is_system          | boolean                       |

    [ ts ]
    index('contact_categories_path_idx').on(t.path)     // subtree query: path LIKE '/a/b/%'
    index('contact_categories_parent_idx').on(t.parentId)

Why materialized path rather than a recursive CTE on parent_id alone: subtree filtering
("all contacts under Manufacturing") becomes an index range scan instead of a recursion
per query. The cost is a subtree rewrite when a node moves -- rare, bounded by depth,
and done in one transaction. Cycles are rejected in the service by checking the
prospective parent's path for the moving node's id. ltree is the alternative and is
stronger, but it is an extension and this stays portable.

8.6 contact_companies
---------------------

  Column            | Type                         | Notes
  ------------------+------------------------------+--------------------------------------------
  ...baseColumns    |                              |
  name              | varchar(255) NOT NULL        |
  legal_name        | varchar(255)                 |
  domain            | varchar(255)                 | Unique live when present. The natural key
                    |                              | for email-domain -> company matching.
  industry          | varchar(120)                 |
  size              | company_size enum            | micro, small, medium, large, enterprise
  website / phone   | varchar(255) / varchar(40)   |
  address           | jsonb                        | Same shape as contacts.address.
  country           | varchar(2)                   |
  parent_company_id | uuid -> contact_companies.id | Group structures.
  owner_user_id     | uuid -> users.id             | Account owner.
  status            | contact_status enum          | Shares the contact status vocabulary.
  description       | text                         |
  logo_file_id      | uuid -> files.id             |
  tax_number        | varchar(60)                  | Used by invoicing (§12.6).
  metadata          | jsonb                        |

    [ ts ]
    uniqueIndex('contact_companies_domain_idx').on(t.domain)
      .where(sql`${t.domain} IS NOT NULL AND ${t.isDeleted} = false`)
    index('contact_companies_name_idx').on(t.name)
    index('contact_companies_owner_idx').on(t.ownerUserId)

8.7 contact_relationships (beyond the listed five -- recommended)
-----------------------------------------------------------------

The edge set that makes this relationship management rather than a contact list.

  Column          | Type                                 | Notes
  ----------------+--------------------------------------+--------------------------------------
  ...baseColumns  |                                      |
  from_contact_id | uuid -> contacts.id NOT NULL         |
  to_contact_id   | uuid -> contacts.id NOT NULL         |
  type            | contact_relationship_type enum NOT   | colleague, reports_to, manages,
                  | NULL                                 | spouse, family, friend, referred_by,
                  |                                      | introduced_by, advisor_to, other
  strength        | relationship_strength enum           | weak, moderate, strong
  since           | date                                 |
  note            | varchar(500)                         |
  created_by      | uuid -> users.id                     |

    [ ts ]
    uniqueIndex('contact_relationships_edge_idx').on(t.fromContactId, t.toContactId, t.type)
      .where(sql`${t.isDeleted} = false`)
    index('contact_relationships_to_idx').on(t.toContactId)

Directed edges, stored once. Symmetric types (colleague, spouse) are rendered from
either side by the service; storing both directions would double the rows and let them
disagree. Self-edges (from = to) are rejected in the service -- expressible as a CHECK
constraint and worth adding.

8.8 contact_interactions (beyond the listed five -- recommended)
----------------------------------------------------------------

Touchpoint history, and the join that makes the existing email_messages table pay off:
every ingested inbound email becomes a timeline entry on the right contact.

  Column           | Type                           | Notes
  -----------------+--------------------------------+-------------------------------------------
  ...baseColumns   |                                |
  contact_id       | uuid -> contacts.id NOT NULL   | cascade
  kind             | interaction_kind enum NOT NULL | email_in, email_out, call, meeting, note,
                   |                                | task, other
  occurred_at      | timestamptz NOT NULL           | The event time, not the row time.
  subject          | varchar(500)                   |
  body             | text                           | Notes; for emails a snippet, since the
                   |                                | body lives in email_messages.
  direction        | interaction_direction enum     | inbound, outbound, internal
  email_message_id | uuid -> email_messages.id      | Set for email interactions.
  project_id       | uuid -> projects.id            | Optional context.
  user_id          | uuid -> users.id               | Who had the interaction. Nullable for
                   |                                | pipeline-created rows.
  duration_minutes | integer                        | Calls/meetings.
  metadata         | jsonb                          |

    [ ts ]
    index('contact_interactions_contact_idx').on(t.contactId, t.occurredAt)
    index('contact_interactions_project_idx').on(t.projectId, t.occurredAt)
    uniqueIndex('contact_interactions_email_idx').on(t.emailMessageId)
      .where(sql`${t.emailMessageId} IS NOT NULL AND ${t.isDeleted} = false`)

The partial unique on email_message_id makes the ingest pipeline idempotent: a mailbox
re-sync of the same message cannot create a second timeline entry. This is the same
discipline email_messages_identity_idx already applies one layer down.

----------------------------------------------------------------------------------------

========================================================================================
9. KNOWLEDGE MANAGEMENT
========================================================================================

Requirement 5 constrains this module to five stores. That is honoured exactly:
knowledge, knowledge_types, knowledge_categories, knowledge_tags,
knowledge_access_control. The only outside dependency is the shared tags vocabulary that
knowledge_tags joins to (§4.1), plus the existing files and search_records tables.

One table was added after review: knowledge_contact_links (§9.6), so a knowledge record
can reference the people it is about, by, or sourced from. It is a link table in the
same family as project_knowledge_links, not a sixth knowledge store -- the knowledge
record itself is unchanged.

    [ diagram -- mermaid source ]
    erDiagram
      knowledge_types      ||--o{ knowledge : classifies
      knowledge_categories ||--o{ knowledge : organizes
      knowledge ||--o{ knowledge_tags : tagged
      tags      ||--o{ knowledge_tags : vocabulary
      knowledge ||--o{ knowledge_access_control : governed_by
      users     ||--o{ knowledge : owns
      files     ||--o{ knowledge : sources
      knowledge ||--o{ search_records : projected_to

9.1 knowledge
-------------

  Column           | Type                                 | Notes
  -----------------+--------------------------------------+-------------------------------------
  ...baseColumns   |                                      |
  title            | varchar(500) NOT NULL                |
  slug             | varchar(255) NOT NULL                | Unique live. Stable URL identity.
  summary          | varchar(1000)                        | Abstract shown in list/search
                   |                                      | results without loading body.
  body             | text                                 | The content.
  format           | knowledge_format enum NOT NULL       | markdown, html, plain, link, file
  type_id          | uuid -> knowledge_types.id           |
  category_id      | uuid -> knowledge_categories.id      |
  status           | knowledge_status enum NOT NULL       | draft, in_review, published,
                   | default draft                        | archived, deprecated
  visibility       | knowledge_visibility enum NOT NULL   | private, restricted, internal. See
                   | default private                      | §9.5.
  version          | integer default 1                    | Bumped on body change; also the
                   |                                      | optimistic-concurrency token.
  owner_user_id    | uuid -> users.id                     | Accountable owner. Nullable --
                   |                                      | agents ingest knowledge under a
                   |                                      | service/system principal.
  author_user_id   | uuid -> users.id                     | Original author; may differ from
                   |                                      | owner after handover.
  reviewer_user_id | uuid -> users.id                     | Set while status = in_review.
  source_url       | varchar(2000)                        | For format = link or imported
                   |                                      | content.
  source_file_id   | uuid -> files.id                     | The original document. Its extracted
                   |                                      | text already flows into the existing
                   |                                      | documents collection via the ingest
                   |                                      | pipeline -- knowledge does not
                   |                                      | re-extract it (§9.8).
  language         | varchar(16) default 'en'             |
  published_at     | timestamptz                          |
  review_due_at    | timestamptz                          | Drives a knowledge.review_due
                   |                                      | notification. Stale knowledge is
                   |                                      | worse than none.
  expires_at       | timestamptz                          | Auto-transition to deprecated.
  view_count       | integer default 0                    | Denormalized, rebuildable from
                   |                                      | activity_log. Ranking hint only.
  metadata         | jsonb                                |

    [ ts ]
    uniqueIndex('knowledge_slug_idx').on(t.slug).where(sql`${t.isDeleted} = false`)
    index('knowledge_status_idx').on(t.status).where(sql`${t.isDeleted} = false`)
    index('knowledge_category_idx').on(t.categoryId)
    index('knowledge_type_idx').on(t.typeId)
    index('knowledge_owner_idx').on(t.ownerUserId)
    index('knowledge_review_due_idx').on(t.reviewDueAt)
      .where(sql`${t.reviewDueAt} IS NOT NULL AND ${t.status} = 'published'`)

The last index is partial on exactly the sweep's predicate -- the same technique
search_records_unsynced_idx uses, so the index stays small no matter how much knowledge
accumulates.

9.2 knowledge_types
-------------------

  Column                       | Type                      | Notes
  -----------------------------+---------------------------+------------------------------------
  ...baseColumns               |                           |
  key                          | varchar(60)               | Unique live. Seeded: article,
                               |                           | runbook, policy, faq, meeting_note,
                               |                           | research, template,
                               |                           | decision_record.
  name / description           |                           |
  icon / color                 | varchar(60) / varchar(16) |
  default_review_interval_days | integer                   | Type-level default for
                               |                           | knowledge.review_due_at -- a policy
                               |                           | needs annual review, a meeting note
                               |                           | never does.
  sort_order                   | integer                   |
  is_system                    | boolean                   |

9.3 knowledge_categories
------------------------

Same hierarchical shape as contact_categories (§8.5) -- parent_id + materialized path +
depth + sort_order + is_system -- for the same reason (subtree reads are a range scan).
Not merged with contact_categories: the two vocabularies are unrelated, and a shared
table would need a scope discriminator on every query while still allowing a contact
category to parent a knowledge category.

9.4 knowledge_tags
------------------

The standard join of §4.1: knowledge_id -> knowledge.id, tag_id -> tags.id, tagged_by,
with a partial unique on the pair and a reverse index on tag_id.

9.5 knowledge_access_control
----------------------------

Row-level grants. Grant-only -- there is no deny.

  Column          | Type                               | Notes
  ----------------+------------------------------------+----------------------------------------
  ...baseColumns  |                                    |
  knowledge_id    | uuid -> knowledge.id NOT NULL      | cascade
  grantee_type    | grantee_type enum NOT NULL         | user, role, authenticated
  grantee_user_id | uuid -> users.id                   | Set iff grantee_type = 'user'.
  grantee_role_id | uuid -> roles.id                   | Set iff grantee_type = 'role'.
  permission      | knowledge_permission enum NOT NULL | read, comment, write, manage (ordered:
                  |                                    | each implies the ones before it).
  granted_by      | uuid -> users.id                   |
  expires_at      | timestamptz                        | Time-boxed sharing. Filtered at read
                  |                                    | time, not only by the sweep.

Exactly-one-grantee is enforced in the database, not only in the service:

    [ sql ]
    ALTER TABLE knowledge_access_control ADD CONSTRAINT knowledge_acl_grantee_ck CHECK (
      (grantee_type = 'user'          AND grantee_user_id IS NOT NULL AND grantee_role_id IS NULL) OR
      (grantee_type = 'role'          AND grantee_role_id IS NOT NULL AND grantee_user_id IS NULL) OR
      (grantee_type = 'authenticated' AND grantee_user_id IS NULL AND grantee_role_id IS NULL)
    );

    [ ts ]
    index('knowledge_acl_knowledge_idx').on(t.knowledgeId)
    index('knowledge_acl_user_idx').on(t.granteeUserId).where(sql`${t.granteeUserId} IS NOT NULL`)
    index('knowledge_acl_role_idx').on(t.granteeRoleId).where(sql`${t.granteeRoleId} IS NOT NULL`)

Resolution (fail-closed, mirroring resolveReadScope):

    canAccess(knowledge, principal, needed):
      if isAdmin(principal) or principal.kind == 'system':      return true
      if principal.kind == 'anonymous':                          return false
      if knowledge.owner_user_id == principal.userId:            return true      # owner => manage
      if knowledge.visibility == 'internal' and needed == read:  return true      # any authenticated
      grants = live, unexpired knowledge_access_control(knowledge) matching
                 user = principal.userId
               or role in user_roles(principal)
               or grantee_type = 'authenticated'
      return max(grants.permission) >= needed

Why grant-only. A deny rule turns access into an order-dependent evaluation, and the
answer to "why can this person see this?" stops being a set membership question. The
three real needs a deny usually covers are met otherwise: revoke by removing the grant,
restrict by visibility = private, and quarantine by status = archived. If a deny is ever
genuinely required, it belongs on user_permissions (§5.8) at the capability layer, not
on individual rows.

Why visibility exists alongside the ACL. Without it, "everyone in the company can read
the handbook" would be one grant row per user. internal is the common case expressed
once; the ACL handles the exceptions. This mirrors collections.visibility -- including
its fail-closed private default, adopted for the reason recorded in search.schema.ts: a
resource that forgets to declare a policy must be invisible, not public.

9.6 knowledge_contact_links -- the contact reference
----------------------------------------------------

  Column         | Type                                  | Notes
  ---------------+---------------------------------------+--------------------------------------
  ...baseColumns |                                       |
  knowledge_id   | uuid -> knowledge.id NOT NULL         | cascade
  contact_id     | uuid -> contacts.id NOT NULL          | cascade
  relation       | knowledge_contact_relation enum NOT   | subject, author, source, expert,
                 | NULL                                  | mentioned
  note           | varchar(500)                          |
  linked_by      | uuid -> users.id                      |

    [ ts ]
    uniqueIndex('knowledge_contact_links_pair_idx').on(t.knowledgeId, t.contactId, t.relation)
      .where(sql`${t.isDeleted} = false`)
    index('knowledge_contact_links_contact_idx').on(t.contactId)   // "everything we know about them"

A meeting note and its attendees, a policy and its owner, research and its interviewee.
The reverse index is the query that makes it worth having: opening a contact shows every
knowledge record that mentions them.

A link grants nothing in either direction. Reading the article still requires an ACL
grant (§9.5), and seeing the contact still requires contact scope (§8.2). This is the
same rule as project_knowledge_links (§10.8), and for the same reason:
link-implies-grant is the most common way document ACLs leak.

9.7 Deliberately not included
-----------------------------

  - knowledge_revisions (full body history). Recommended but out of scope per
    requirement 5's "only include" constraint. version + activity_log.changes records
    that and by whom a change happened, not the prior body. If revisions are wanted, the
    table is (knowledge_id, version, title, body, changed_by, change_note, created_at),
    append-only, and slots in without touching anything else. Declined -- see §15 Q3.
  - knowledge_relations (see-also / supersedes graph). Same reasoning.

9.8 Relationship to the existing document pipeline
--------------------------------------------------

These are two layers, not two copies:

             | files + documents collection (exists)   | knowledge (new)
  -----------+-----------------------------------------+----------------------------------------
  Unit       | A chunk of extracted text from an       | A curated, owned, reviewable article
             | uploaded file                           |
  Created by | Upload -> document-ingest.processor     | A human or an agent, deliberately
  Lifecycle  | Follows the file                        | Draft -> review -> published ->
             |                                         | deprecated
  Access     | owner_scoped by ownerUserId             | ACL + visibility (§9.5)

A knowledge row may point at source_file_id; the file's chunks stay in the documents
collection. Knowledge is not re-chunked into documents -- that would double-index the
same text and make one hit appear twice. Knowledge gets its own collection (§13).

----------------------------------------------------------------------------------------

========================================================================================
10. PROJECT MANAGEMENT
========================================================================================

    [ diagram -- mermaid source ]
    erDiagram
      projects ||--o{ project_members : staffed_by
      projects ||--o{ milestones : has
      projects ||--o{ tasks : contains
      projects ||--o{ goals : pursues
      projects ||--o{ project_knowledge_links : references
      projects ||--o{ project_contact_links : involves
      projects ||--o{ time_entries : logs
      milestones ||--o{ tasks : groups
      tasks ||--o{ tasks : subtasks
      tasks ||--o{ task_dependencies : blocks
      tasks ||--o{ task_watchers : watched_by
      tasks ||--o{ time_entries : tracked_by
      goals ||--o{ goals : key_results
      knowledge ||--o{ project_knowledge_links : referenced_by
      contacts  ||--o{ project_contact_links : linked_to
      users ||--o{ project_members : member

10.1 projects
-------------

  Column                     | Type                            | Notes
  ---------------------------+---------------------------------+--------------------------------
  ...baseColumns             |                                 |
  key                        | varchar(20) NOT NULL            | Short human code (ACME, PLAT).
                             |                                 | Unique live. Prefixes task
                             |                                 | numbers (§10.4).
  name                       | varchar(255) NOT NULL           |
  description                | text                            |
  status                     | project_status enum NOT NULL    | draft, active, on_hold,
                             | default draft                   | completed, archived, cancelled
  priority                   | priority_level enum default     | low, medium, high, urgent.
                             | medium                          | Shared with tasks -- one
                             |                                 | vocabulary.
  owner_user_id              | uuid -> users.id                | Nullable, per Q7. A human owner
                             |                                 | is the norm and every
                             |                                 | user-initiated path sets it via
                             |                                 | requireUserId. It is nullable
                             |                                 | only because agents may create
                             |                                 | projects autonomously, and a
                             |                                 | scheduled run has no triggering
                             |                                 | user; such a project is unowned
                             |                                 | and surfaced for claiming by
                             |                                 | projects_unowned_idx.
  lead_user_id               | uuid -> users.id                | Day-to-day lead; may differ
                             |                                 | from owner.
  parent_project_id          | uuid -> projects.id             | Programme/portfolio nesting.
                             |                                 | Depth capped; cycles rejected.
  visibility                 | project_visibility enum NOT     | private (members + admin),
                             | NULL default private            | internal (any authenticated
                             |                                 | user may read)
  start_date / due_date      | date                            | Planning dates carry no time
                             |                                 | zone.
  completed_at / archived_at | timestamptz                     | Event instants do.
  progress_pct               | integer default 0               | Denormalized 0-100, recomputed
                             |                                 | from task completion on task
                             |                                 | write. Display only -- never a
                             |                                 | source of truth, and
                             |                                 | rebuildable by a sweep.
  budget_amount / currency   | numeric(20,4) / varchar(3)      | Present even without the
                             |                                 | finance module; §12 reconciles
                             |                                 | actuals against it.
  color                      | varchar(16)                     |
  metadata                   | jsonb                           |

    [ ts ]
    uniqueIndex('projects_key_idx').on(t.key).where(sql`${t.isDeleted} = false`)
    index('projects_status_idx').on(t.status).where(sql`${t.isDeleted} = false`)
    index('projects_owner_idx').on(t.ownerUserId)
    index('projects_unowned_idx').on(t.createdAt)
      .where(sql`${t.ownerUserId} IS NULL AND ${t.isDeleted} = false`)   // agent-created, unclaimed
    index('projects_due_idx').on(t.dueDate).where(sql`${t.status} = 'active'`)

10.2 project_members
--------------------

The row-level authorization table for the whole module.

  Column               | Type                              | Notes
  ---------------------+-----------------------------------+------------------------------------
  ...baseColumns       |                                   |
  project_id / user_id | FKs NOT NULL                      | cascade
  role_in_project      | project_member_role enum NOT NULL | owner, manager, contributor, viewer
                       |                                   | (ordered: each implies the ones
                       |                                   | after it).
  added_by             | uuid -> users.id                  |
  joined_at            | timestamptz                       |

    [ ts ]
    uniqueIndex('project_members_pair_idx').on(t.projectId, t.userId).where(sql`${t.isDeleted} = false`)
    index('project_members_user_idx').on(t.userId)     // "my projects" -- the most frequent query

Access resolution (one function, resolveProjectScope, returning data not exceptions):

    projectAccess(project, principal):
      if isAdmin(principal) or principal.kind == 'system':  return 'owner'
      if principal.kind != 'user':                          return null
      if project.owner_user_id == principal.userId:         return 'owner'
      m = live project_members(project, principal.userId)
      if m:                                                 return m.role_in_project
      if project.visibility == 'internal':                  return 'viewer'
      return null      # fail closed

Everything below a project -- tasks, milestones, goals, comments, attachments, time
entries -- inherits this scope. There is no second ACL per task; a task's readability is
its project's.

10.3 milestones
---------------

  Column         | Type                                  | Notes
  ---------------+---------------------------------------+--------------------------------------
  ...baseColumns |                                       |
  project_id     | uuid -> projects.id NOT NULL          | cascade
  name           | varchar(255) NOT NULL                 |
  description    | text                                  |
  status         | milestone_status enum NOT NULL        | pending, in_progress, reached,
                 | default pending                       | missed, cancelled
  due_date       | date                                  |
  reached_at     | timestamptz                           |
  owner_user_id  | uuid -> users.id                      |
  sort_order     | integer                               | Short, ordered list -> integer is
                 |                                       | adequate (§4.9).

    [ ts ]
    index('milestones_project_idx').on(t.projectId, t.sortOrder)
    index('milestones_due_idx').on(t.dueDate).where(sql`${t.status} <> 'reached'`)

10.4 tasks
----------

  Column                        | Type                          | Notes
  ------------------------------+-------------------------------+-------------------------------
  ...baseColumns                |                               |
  project_id                    | uuid -> projects.id NOT NULL  | Required -- see the note
                                |                               | below.
  milestone_id                  | uuid -> milestones.id         | Optional grouping.
  parent_task_id                | uuid -> tasks.id              | Subtasks. Depth capped at 2 in
                                |                               | the service; deeper nesting is
                                |                               | a project.
  number                        | integer NOT NULL              | Per-project sequence, rendered
                                |                               | as ACME-42. Allocated by
                                |                               | UPDATE projects SET task_seq =
                                |                               | task_seq + 1 RETURNING inside
                                |                               | the insert transaction -- a
                                |                               | counter column, not
                                |                               | max(number)+1, which races.
  title                         | varchar(500) NOT NULL         |
  description                   | text                          |
  status                        | task_status enum NOT NULL     | backlog, todo, in_progress,
                                | default todo                  | blocked, in_review, done,
                                |                               | cancelled
  priority                      | priority_level enum default   | Shared vocabulary with
                                | medium                        | projects.
  assignee_user_id              | uuid -> users.id              | Single accountable assignee.
  reporter_user_id              | uuid -> users.id              | Creator. Nullable for
                                |                               | agent-created tasks
                                |                               | (userIdOrNull).
  estimate_minutes /            | integer                       | spent_minutes is denormalized
  spent_minutes                 |                               | from time_entries.
  start_date / due_date         | date                          |
  completed_at                  | timestamptz                   |
  blocked_reason                | varchar(500)                  | Required by the service when
                                |                               | status = blocked. A blocked
                                |                               | task with no stated blocker is
                                |                               | invisible work.
  sort_rank                     | varchar(64)                   | LexoRank within the board
                                |                               | column (§4.9).
  external_ref                  | varchar(255)                  | Foreign tracker id, for
                                |                               | import/sync.
  metadata                      | jsonb                         |

    [ ts ]
    uniqueIndex('tasks_number_idx').on(t.projectId, t.number).where(sql`${t.isDeleted} = false`)
    index('tasks_project_status_idx').on(t.projectId, t.status)
    index('tasks_assignee_idx').on(t.assigneeUserId, t.status)   // "my open tasks"
    index('tasks_milestone_idx').on(t.milestoneId)
    index('tasks_due_idx').on(t.dueDate).where(sql`${t.status} NOT IN ('done','cancelled')`)
    index('tasks_board_idx').on(t.projectId, t.status, t.sortRank)

Why project_id is required. A nullable project makes every access check branch: a task
with no project has no membership to inherit, so it needs its own ACL, and the module
grows a second authorization path used by a minority of rows.

Q4 confirmed that personal to-dos are not a workflow this system supports, so the
auto-created "personal project" an earlier draft proposed is also gone. Every task
belongs to a real project, and there is exactly one authorization path.

10.5 task_dependencies
----------------------

  Column                        | Type                          | Notes
  ------------------------------+-------------------------------+-------------------------------
  ...baseColumns                |                               |
  predecessor_task_id /         | uuid -> tasks.id NOT NULL     |
  successor_task_id             |                               |
  type                          | dependency_type enum NOT NULL | finish_to_start,
                                | default finish_to_start       | start_to_start,
                                |                               | finish_to_finish,
                                |                               | start_to_finish
  lag_days                      | integer default 0             |

    [ ts ]
    uniqueIndex('task_dependencies_pair_idx').on(t.predecessorTaskId, t.successorTaskId)
      .where(sql`${t.isDeleted} = false`)
    index('task_dependencies_successor_idx').on(t.successorTaskId)

Cycle prevention is a service-layer recursive check before insert (the graph is small
and project-local). CHECK (predecessor_task_id <> successor_task_id) catches the trivial
case in the database.

10.6 task_watchers
------------------

  Column            | Type              | Notes
  ------------------+-------------------+-------------------------------------------------------
  ...baseColumns    |                   |
  task_id / user_id | FKs NOT NULL      | cascade
  reason            | watch_reason enum | manual, assigned, commented, mentioned, reporter --
                    |                   | lets the notification layer explain why someone was
                    |                   | emailed and lets them unwatch precisely.

    [ ts ]
    uniqueIndex('task_watchers_pair_idx').on(t.taskId, t.userId).where(sql`${t.isDeleted} = false`)
    index('task_watchers_user_idx').on(t.userId)

This is the recipient set for task notifications (§11), which is why it is a table and
not a computed union at send time.

10.7 goals
----------

Objectives and their measurable key results, in one self-referencing table.

  Column                       | Type                           | Notes
  -----------------------------+--------------------------------+-------------------------------
  ...baseColumns               |                                |
  project_id                   | uuid -> projects.id            | Nullable -- organizational
                               |                                | goals exist above any project.
                               |                                | When null the goal is
                               |                                | org-scoped and readable by any
                               |                                | authenticated user; when set
                               |                                | it inherits project scope.
  parent_goal_id               | uuid -> goals.id               | A key result's objective.
  kind                         | goal_kind enum NOT NULL        | objective, key_result. A
                               |                                | key_result must have a parent;
                               |                                | an objective must not.
                               |                                | Enforced in the service.
  title                        | varchar(500) NOT NULL          |
  description                  | text                           |
  owner_user_id                | uuid -> users.id               |
  status                       | goal_status enum NOT NULL      | draft, active, at_risk,
                               | default active                 | achieved, missed, cancelled
  metric_name                  | varchar(120)                   | Key results only.
  target_value / current_value | numeric(20,4)                  |
  unit                         | varchar(40)                    | %, USD, count.
  direction                    | goal_direction enum            | increase, decrease, maintain
                               |                                | -- without it, "current 40 of
                               |                                | target 30" is unreadable.
  start_date / due_date        | date                           |
  achieved_at                  | timestamptz                    |
  progress_pct                 | integer                        | Derived from the values and
                               |                                | direction; stored for list
                               |                                | rendering.

    [ ts ]
    index('goals_project_idx').on(t.projectId)
    index('goals_parent_idx').on(t.parentGoalId)
    index('goals_owner_status_idx').on(t.ownerUserId, t.status)

10.8 project_knowledge_links -- the knowledge reference
-------------------------------------------------------

  Column         | Type                                  | Notes
  ---------------+---------------------------------------+--------------------------------------
  ...baseColumns |                                       |
  project_id     | uuid -> projects.id NOT NULL          | cascade
  knowledge_id   | uuid -> knowledge.id NOT NULL         | cascade
  task_id        | uuid -> tasks.id                      | Optional finer anchor: this article
                 |                                       | backs this task.
  relation       | knowledge_relation enum NOT NULL      | reference, requirement, deliverable,
                 | default reference                     | background
  note           | varchar(500)                          |
  linked_by      | uuid -> users.id                      |

    [ ts ]
    uniqueIndex('project_knowledge_links_pair_idx').on(t.projectId, t.knowledgeId, t.relation)
      .where(sql`${t.isDeleted} = false`)
    index('project_knowledge_links_knowledge_idx').on(t.knowledgeId)   // "where is this used?"

A link does not grant access. Referencing an article from a project the caller can read
does not make the article readable -- knowledge_access_control still decides, and the UI
shows a reference the caller cannot open as a locked stub. Link-implies-grant is the
single most common way document ACLs leak.

10.9 project_contact_links -- the contact reference
---------------------------------------------------

  Column         | Type                                  | Notes
  ---------------+---------------------------------------+--------------------------------------
  ...baseColumns |                                       |
  project_id     | uuid -> projects.id NOT NULL          | cascade
  contact_id     | uuid -> contacts.id NOT NULL          | cascade
  company_id     | uuid -> contact_companies.id          | Denormalized from the contact at link
                 |                                       | time; a contact can change employer,
                 |                                       | and the project's client should not
                 |                                       | silently change with it.
  relationship   | project_contact_relationship enum NOT | client, stakeholder, vendor, partner,
                 | NULL                                  | sponsor, other
  is_primary     | boolean                               | At most one primary per (project,
                 |                                       | relationship).
  note           | varchar(500)                          |
  linked_by      | uuid -> users.id                      |

    [ ts ]
    uniqueIndex('project_contact_links_pair_idx').on(t.projectId, t.contactId, t.relationship)
      .where(sql`${t.isDeleted} = false`)
    uniqueIndex('project_contact_links_primary_idx').on(t.projectId, t.relationship)
      .where(sql`${t.isPrimary} = true AND ${t.isDeleted} = false`)
    index('project_contact_links_contact_idx').on(t.contactId)

10.10 time_entries
------------------

The bridge from project execution to billing (§12).

  Column                    | Type                           | Notes
  --------------------------+--------------------------------+----------------------------------
  ...baseColumns            |                                |
  task_id                   | uuid -> tasks.id               | Nullable: project-level time with
                            |                                | no task.
  project_id                | uuid -> projects.id NOT NULL   | Denormalized from the task so
                            |                                | project reports never join
                            |                                | through tasks.
  user_id                   | uuid -> users.id NOT NULL      |
  started_at                | timestamptz                    |
  minutes                   | integer NOT NULL               | The authoritative duration. A
                            |                                | stopwatch writes started_at +
                            |                                | minutes; manual entry writes
                            |                                | minutes alone. Storing an end
                            |                                | time as well invites the two to
                            |                                | disagree.
  work_date                 | date NOT NULL                  | The day the work is attributed to
                            |                                | -- not derivable from started_at
                            |                                | across time zones and night
                            |                                | shifts.
  description               | varchar(500)                   |
  is_billable               | boolean default false          |
  hourly_rate / currency    | numeric(20,4) / varchar(3)     | Snapshotted at entry time; rates
                            |                                | change and history must not.
  invoice_line_item_id      | uuid -> invoice_line_items.id  | Set once billed. Its presence is
                            |                                | the "already invoiced" lock.
  approved_by / approved_at | uuid -> users.id / timestamptz |

    [ ts ]
    index('time_entries_project_date_idx').on(t.projectId, t.workDate)
    index('time_entries_user_date_idx').on(t.userId, t.workDate)
    index('time_entries_task_idx').on(t.taskId)
    index('time_entries_unbilled_idx').on(t.projectId)
      .where(sql`${t.isBillable} = true AND ${t.invoiceLineItemId} IS NULL AND ${t.isDeleted} = false`)

The last index is the "what can we bill?" query, partial on exactly that predicate.

----------------------------------------------------------------------------------------

========================================================================================
11. NOTIFICATION MANAGEMENT
========================================================================================

Requirement 6: email is the only channel. The model still carries a channel enum with
one value -- adding in_app or webhook later becomes an enum value and a transport, not a
schema migration of every table.

    [ diagram -- mermaid source ]
    graph LR
      EV["Domain event<br/>task.assigned"] --> RES["Recipient resolution<br/>watchers, assignee, mentions"]
      RES --> PREF["notification_preferences<br/>enabled? digest? quiet hours?"]
      PREF --> SUP["notification_suppressions<br/>bounced / unsubscribed?"]
      SUP --> OUT["notifications (outbox row)"]
      OUT --> Q["BullMQ notification-send"]
      Q --> SMTP["MailerService + smtp_configs"]
      Q --> ATT["notification_delivery_attempts"]

11.1 Why an outbox table rather than "just send it"
---------------------------------------------------

An email sent inside the transaction that created the task is sent even if the
transaction rolls back. An email sent after commit is lost if the process dies between
the two.

The notifications row is written in the same transaction as the business change, with
status = pending. A queue job (or a sweep, for durability) picks it up afterwards. This
is exactly the outbox pattern search_records.index_state already implements for
Meilisearch, and it is reused here rather than invented.

11.2 notification_event_types
-----------------------------

The stable catalog every preference and template keys off.

  Column               | Type                  | Notes
  ---------------------+-----------------------+------------------------------------------------
  ...baseColumns       |                       |
  key                  | varchar(120)          | Unique live. task.assigned, task.due_soon,
                       |                       | project.member_added, knowledge.review_due,
                       |                       | invoice.overdue, contact.follow_up_due,
                       |                       | auth.password_reset.
  name / description   |                       | Rendered on the preferences screen.
  category             | varchar(60)           | Groups the preferences UI: project, knowledge,
                       |                       | crm, finance, system, security.
  default_enabled      | boolean default true  | Applied when a user has no preference row.
  is_digestable        | boolean default true  | False for time-critical events.
  is_mandatory         | boolean default false | Security and transactional mail
                       |                       | (auth.password_reset) that a user may not
                       |                       | switch off. Without this column an opt-out
                       |                       | silently disables password reset delivery.
  default_template_key | varchar(120)          |
  is_system            | boolean               |

Same boot-time assertion as permissions (§5.4): every event key emitted in code must
resolve to a seeded row, or the app refuses to start.

11.3 notification_templates
---------------------------

  Column             | Type                                | Notes
  -------------------+-------------------------------------+------------------------------------
  ...baseColumns     |                                     |
  key                | varchar(120) NOT NULL               | Unique per (key, locale, channel)
                     |                                     | among live rows.
  locale             | varchar(16) NOT NULL default 'en'   | Chosen from user_profiles.locale,
                     |                                     | falling back to 'en'.
  channel            | notification_channel enum NOT NULL  |
                     | default email                       |
  name / description |                                     |
  subject_template   | varchar(500) NOT NULL               |
  body_text_template | text NOT NULL                       | Always sent -- mirrors
                     |                                     | EmailMessage.text being required in
                     |                                     | email.types.ts.
  body_html_template | text                                | Optional, mirroring
                     |                                     | EmailMessage.html.
  variables          | jsonb                               | Declared variable names +
                     |                                     | JSON-Schema types. Validated when
                     |                                     | the template is saved and when a
                     |                                     | notification is enqueued, so a
                     |                                     | renamed field surfaces at save time
                     |                                     | rather than as a blank line in a
                     |                                     | customer's inbox.
  is_active          | boolean default true                |
  version            | integer default 1                   |

    [ ts ]
    uniqueIndex('notification_templates_key_idx').on(t.key, t.locale, t.channel)
      .where(sql`${t.isDeleted} = false`)

Templates are data, not code, so wording changes need no deploy. The rendering engine is
a logic-less substitution ({{ variable }}) -- a template language with loops and
conditionals in a database row is a code path with no tests and no review.

11.4 notification_preferences
-----------------------------

  Column                        | Type                          | Notes
  ------------------------------+-------------------------------+-------------------------------
  ...baseColumns                |                               |
  user_id                       | uuid -> users.id NOT NULL     | cascade
  event_type_id                 | uuid ->                       |
                                | notification_event_types.id   |
                                | NOT NULL                      |
  channel                       | notification_channel enum NOT |
                                | NULL default email            |
  enabled                       | boolean NOT NULL default true |
  frequency                     | notification_frequency enum   | immediate, hourly, daily,
                                | NOT NULL default immediate    | weekly, off
  quiet_hours_start /           | integer (0-23)                | Local hours, interpreted in
  quiet_hours_end               |                               | user_profiles.timezone.
                                |                               | Deferred, not dropped.

    [ ts ]
    uniqueIndex('notification_preferences_unique_idx').on(t.userId, t.eventTypeId, t.channel)
      .where(sql`${t.isDeleted} = false`)
    index('notification_preferences_event_idx').on(t.eventTypeId, t.enabled)

Absence of a row means default_enabled from the event type. Rows are written only when a
user changes something -- no fan-out of NxM rows per signup.

A global notifications_enabled master switch lives in user_preferences (§7.3) under the
key notifications.enabled; is_mandatory events ignore both it and the per-event row.

11.5 notifications (outbox + history, partitioned)
--------------------------------------------------

  Column                  | Type                             | Notes
  ------------------------+----------------------------------+----------------------------------
  ...baseColumns          |                                  | Soft-deletable so a user can
                          |                                  | clear history without losing the
                          |                                  | delivery audit.
  recipient_user_id       | uuid -> users.id                 | Nullable: recipients can be
                          |                                  | contacts with no account.
  recipient_contact_id    | uuid -> contacts.id              | Nullable.
  recipient_email         | varchar(320) NOT NULL            | Resolved and snapshotted at
                          |                                  | enqueue. A later email change
                          |                                  | must not silently redirect an
                          |                                  | already-queued message.
  event_type_id           | uuid ->                          |
                          | notification_event_types.id NOT  |
                          | NULL                             |
  template_id             | uuid ->                          | Which template rendered it.
                          | notification_templates.id        |
  channel                 | notification_channel enum NOT    |
                          | NULL                             |
  subject                 | varchar(500) NOT NULL            | Rendered, stored -- this is the
                          |                                  | history line.
  body_preview            | varchar(1000)                    | First N characters. Full bodies
                          |                                  | are not stored by default
                          |                                  | (§11.8).
  payload                 | jsonb NOT NULL default {}        | The template variables.
                          |                                  | Re-renders the message on demand
                          |                                  | without storing it.
  entity_type / entity_id | enum / uuid                      | Deep-link subject.
  project_id              | uuid -> projects.id              | Denormalized scope key, as in
                          |                                  | activity_log.
  status                  | notification_status enum NOT     | pending, queued, sent, delivered,
                          | NULL default pending             | bounced, failed, suppressed,
                          |                                  | cancelled
  priority                | priority_level enum              | Shared vocabulary; orders the
                          |                                  | queue.
  scheduled_for           | timestamptz                      | Digest window or quiet-hours
                          |                                  | deferral.
  sent_at                 | timestamptz                      |
  attempts                | integer default 0                |
  last_error              | varchar(1000)                    | Mirrors
                          |                                  | search_records.index_error.
  provider_message_id     | varchar(255)                     | SMTP message id, for bounce
                          |                                  | correlation.
  dedupe_key              | varchar(255)                     | Unique among live rows.
                          |                                  | Idempotency:
                          |                                  | task.assigned:{taskId}:{userId}
                          |                                  | cannot be delivered twice by a
                          |                                  | retried job.
  digest_group_key        | varchar(255)                     | Rows sharing it collapse into one
                          |                                  | digest email.

    [ ts ]
    uniqueIndex('notifications_dedupe_idx').on(t.dedupeKey)
      .where(sql`${t.dedupeKey} IS NOT NULL AND ${t.isDeleted} = false`)
    index('notifications_sendable_idx').on(t.scheduledFor)
      .where(sql`${t.status} IN ('pending','queued')`)
    index('notifications_recipient_idx').on(t.recipientUserId, t.createdAt)
    index('notifications_digest_idx').on(t.digestGroupKey)
      .where(sql`${t.digestGroupKey} IS NOT NULL AND ${t.status} = 'pending'`)
    index('notifications_status_idx').on(t.status, t.createdAt)

notifications_sendable_idx is the sweep's exact predicate, partial so it holds only
unsent rows -- the same reasoning as search_records_unsynced_idx.

11.6 notification_delivery_attempts (append-only, partitioned)
--------------------------------------------------------------

  Column                        | Type                          | Notes
  ------------------------------+-------------------------------+-------------------------------
  id / created_at               |                               | Append-only, no baseColumns.
  notification_id               | uuid -> notifications.id NOT  |
                                | NULL                          |
  attempt_number                | integer NOT NULL              |
  status                        | notification_status enum NOT  | Outcome of this attempt.
                                | NULL                          |
  smtp_config_id                | uuid -> smtp_configs.id       | Which sender profile was used
                                |                               | -- decisive when one relay
                                |                               | starts failing.
  response_code /               | varchar(20) / varchar(1000)   |
  response_message              |                               |
  duration_ms                   | integer                       |

    [ ts ]
    index('notification_delivery_attempts_notification_idx').on(t.notificationId, t.attemptNumber)

Separated from notifications so the outbox row stays narrow and hot while the diagnostic
history -- which is what actually grows -- sits in a partitioned table with its own
retention.

11.7 notification_suppressions
------------------------------

The list checked before every send. Without it, one hard bounce repeated daily is how a
sending domain gets blacklisted.

  Column         | Type                                | Notes
  ---------------+-------------------------------------+----------------------------------------
  ...baseColumns |                                     |
  email          | varchar(320) NOT NULL               | Lowercased. Unique live.
  reason         | suppression_reason enum NOT NULL    | hard_bounce, soft_bounce_repeated,
                 |                                     | complaint, unsubscribe, manual, invalid
  event_type_id  | uuid -> notification_event_types.id | Null = suppress everything; set =
                 |                                     | suppress one event type only.
  source         | varchar(120)                        | Bounce processor, admin, user link.
  expires_at     | timestamptz                         | Soft bounces expire; hard bounces do
                 |                                     | not.
  note           | varchar(500)                        |

    [ ts ]
    uniqueIndex('notification_suppressions_email_idx').on(t.email, t.eventTypeId)
      .where(sql`${t.isDeleted} = false`)

A suppressed send writes status = suppressed, not failed -- a suppression is a correct
outcome, and conflating the two hides real failures in the metrics.

A mandatory event bypasses preferences but never bypasses a hard bounce or complaint
suppression. Sending to a complained address is a deliverability and compliance problem
regardless of how important the message is.

11.8 Body storage -- an explicit decision
-----------------------------------------

Rendered bodies are not persisted by default. subject + body_preview + payload are
enough to show history and to re-render on demand, while full bodies would put
customer-visible PII into a fast-growing table with a long tail.

Where a compliance regime requires proof of exact content sent, the mitigation is a
system_settings flag (notifications.persist_body) that additionally stores the rendered
body, governed by its own data_retention_policies row. Making it a setting keeps the
default safe and the exception deliberate.

----------------------------------------------------------------------------------------

========================================================================================
12. FINANCIAL MANAGEMENT
========================================================================================

Confirmed scope (Q2): operational. Project- and client-centric finance -- budgets,
spending, income, billable time, invoicing, payments. Not statutory double-entry
bookkeeping. The upgrade path is in §12.9.

Income is tracked on the same three axes as spending, not bolted on:

   - Received -- a transactions row with kind = 'income', carrying contact_id /
     company_id for the payer, project_id for attribution, and a financial_categories
     row of kind = 'income'.
   - Expected -- a recurring_transactions schedule (§12.6), so a retainer that fails to
     arrive is visible as a missed occurrence rather than as silence.
   - Billed -- invoices -> payments -> transactions, so invoiced revenue and received
     cash reconcile against each other instead of being two unrelated numbers.

    [ diagram -- mermaid source ]
    erDiagram
      financial_accounts   ||--o{ transactions : posts_to
      financial_categories ||--o{ transactions : classifies
      financial_categories ||--o{ budgets : scopes
      projects ||--o{ transactions : attributed_to
      projects ||--o{ budgets : constrains
      projects ||--o{ invoices : billed_from
      contacts ||--o{ invoices : billed_to
      contact_companies ||--o{ invoices : billed_to
      invoices ||--o{ invoice_line_items : contains
      invoices ||--o{ payments : settled_by
      time_entries ||--o{ invoice_line_items : billed_as
      payments ||--o{ transactions : recorded_as

12.1 currencies and fx_rates
----------------------------

currencies: code varchar(3) (PK-by-unique-index), name, symbol, minor_unit integer,
is_active. Seeded from ISO-4217. The system's base currency is a system_settings row
(finance.base_currency), not a hard-coded constant.

fx_rates (append-only): base_code, quote_code, rate numeric(20,10), as_of date, source.

    [ ts ]
    uniqueIndex('fx_rates_pair_date_idx').on(t.baseCode, t.quoteCode, t.asOf)

Historical rates are kept because a report over last quarter must use last quarter's
rates. A system holding only current rates silently rewrites its own history every day.

12.2 financial_accounts
-----------------------

  Column                    | Type                        | Notes
  --------------------------+-----------------------------+-------------------------------------
  ...baseColumns            |                             |
  name                      | varchar(150) NOT NULL       |
  kind                      | account_kind enum NOT NULL  | bank, cash, credit_card, receivable,
                            |                             | payable, other
  currency                  | varchar(3) NOT NULL         | An account is single-currency.
                            |                             | Multi-currency holdings are separate
                            |                             | accounts -- the alternative silently
                            |                             | mixes units in a balance.
  opening_balance           | numeric(20,4) default 0     |
  current_balance           | numeric(20,4) default 0     | Denormalized, updated
                            |                             | transactionally with each posting,
                            |                             | and reconcilable by summing
                            |                             | transactions. Recomputing every
                            |                             | balance from the ledger on read does
                            |                             | not survive growth.
  institution / account_ref | varchar(150) / varchar(120) | Masked account reference -- never a
                            |                             | full number.
  is_active                 | boolean                     |

12.3 financial_categories
-------------------------

Hierarchical, same parent_id + path + depth shape as the other category trees (§8.5).
Additional column: kind financial_category_kind enum -- income, expense, transfer. A
category's kind must match the transactions filed under it, checked in the service.

12.4 budgets
------------

  Column                    | Type                            | Notes
  --------------------------+---------------------------------+---------------------------------
  ...baseColumns            |                                 |
  name                      | varchar(150) NOT NULL           |
  project_id                | uuid -> projects.id             | Nullable -- departmental budgets
                            |                                 | exist without a project.
  category_id               | uuid -> financial_categories.id | Nullable -- a whole-project
                            |                                 | budget has no category.
  period_start / period_end | date NOT NULL                   |
  amount / currency         | numeric(20,4) / varchar(3) NOT  |
                            | NULL                            |
  spent_amount              | numeric(20,4) default 0         | Denormalized from cleared
                            |                                 | transactions.
  alert_threshold_pct       | integer default 80              | Fires budget.threshold_reached
                            |                                 | (§11).
  owner_user_id             | uuid -> users.id                |
  status                    | budget_status enum              | draft, active, closed, exceeded

    [ ts ]
    index('budgets_project_period_idx').on(t.projectId, t.periodStart, t.periodEnd)

12.5 transactions
-----------------

The operational ledger: one signed row per movement.

  Column                        | Type                          | Notes
  ------------------------------+-------------------------------+-------------------------------
  ...baseColumns                |                               |
  kind                          | transaction_kind enum NOT     | income, expense, transfer
                                | NULL                          |
  occurred_on                   | date NOT NULL                 | The accounting date --
                                |                               | distinct from created_at,
                                |                               | which is when it was entered.
                                |                               | Backdated entries are normal.
  amount                        | numeric(20,4) NOT NULL        | Always positive; kind carries
                                |                               | the sign. A signed amount plus
                                |                               | a kind is two sources of truth
                                |                               | that will disagree.
  currency                      | varchar(3) NOT NULL           |
  base_amount / fx_rate /       | numeric(20,4) /               | Reporting in base currency
  fx_rate_at                    | numeric(20,10) / date         | without re-deriving history
                                |                               | (§4.8).
  account_id                    | uuid -> financial_accounts.id |
                                | NOT NULL                      |
  counter_account_id            | uuid -> financial_accounts.id | Required when kind =
                                |                               | 'transfer'.
  category_id                   | uuid ->                       |
                                | financial_categories.id       |
  project_id / task_id          | FKs                           | Cost attribution.
  contact_id / company_id       | FKs -> contacts /             | The CRM reference. Payer for
                                | contact_companies             | income, payee for spending.
                                |                               | Indexed both ways, so
                                |                               | "everything received from or
                                |                               | paid to this contact" is one
                                |                               | scan.
  invoice_id                    | uuid -> invoices.id           | Set when this transaction
                                |                               | settles an invoice.
  description                   | varchar(500) NOT NULL         |
  reference                     | varchar(120)                  | Bank reference / external id.
  receipt_file_id               | uuid -> files.id              | Additional receipts go through
                                |                               | entity_attachments.
  status                        | transaction_status enum NOT   | draft, pending, cleared,
                                | NULL default draft            | reconciled, void
  reverses_transaction_id       | uuid -> transactions.id       | A correction is a reversing
                                |                               | entry, never an edit (§4.8).
  created_by                    | uuid -> users.id              |
  metadata                      | jsonb                         |

    [ ts ]
    index('transactions_account_date_idx').on(t.accountId, t.occurredOn)
    index('transactions_project_date_idx').on(t.projectId, t.occurredOn)
    index('transactions_category_idx').on(t.categoryId, t.occurredOn)
    index('transactions_invoice_idx').on(t.invoiceId)
    index('transactions_contact_idx').on(t.contactId)
    index('transactions_company_idx').on(t.companyId)
    index('transactions_kind_date_idx').on(t.kind, t.occurredOn)   // income vs spend reporting
    index('transactions_status_idx').on(t.status).where(sql`${t.status} <> 'reconciled'`)

12.6 recurring_transactions
---------------------------

Expected, repeating money: retainers and salary on the income side, subscriptions and
rent on the expense side. Without it, income tracking only ever sees money that has
already arrived -- nothing can be forecast, and a receipt that never turns up is
indistinguishable from one that was never due.

  Column                        | Type                          | Notes
  ------------------------------+-------------------------------+-------------------------------
  ...baseColumns                |                               |
  name                          | varchar(150) NOT NULL         |
  kind                          | transaction_kind enum NOT     | Same vocabulary as the ledger
                                | NULL                          | -- income and expense
                                |                               | schedules are one mechanism,
                                |                               | not two.
  amount / currency             | numeric(20,4) / varchar(3)    |
                                | NOT NULL                      |
  frequency                     | recurrence_frequency enum NOT | weekly, fortnightly, monthly,
                                | NULL                          | quarterly, yearly
  day_of_period                 | integer                       | Anchor day, interpreted per
                                |                               | frequency.
  start_date / end_date         | date                          |
  next_due_on                   | date                          | What the scheduler reads.
  last_generated_on             | date                          | Makes generation idempotent --
                                |                               | a re-run cannot double-post.
  account_id / category_id /    | FKs                           | Defaults copied onto each
  project_id                    |                               | generated row.
  contact_id / company_id       | FKs                           | The counterparty -- a retainer
                                |                               | belongs to a client.
  auto_post                     | boolean default false         | False = forecast only; nothing
                                |                               | posts without confirmation.
  is_active                     | boolean                       |

    [ ts ]
    index('recurring_transactions_due_idx').on(t.nextDueOn)
      .where(sql`${t.isActive} = true AND ${t.isDeleted} = false`)
    index('recurring_transactions_kind_idx').on(t.kind)
    index('recurring_transactions_contact_idx').on(t.contactId)

The scheduler materializes one transactions row per occurrence -- status = 'pending'
until confirmed, or posted directly when auto_post is set -- and advances next_due_on.

auto_post defaults to false deliberately. A schedule that posts unattended turns a
forecast into a ledger entry nobody checked, and undoing it costs a reversing entry
rather than a delete. Forecast first; posting is opt-in per schedule.

12.7 invoices
-------------

  Column                        | Type                          | Notes
  ------------------------------+-------------------------------+-------------------------------
  ...baseColumns                |                               |
  number                        | varchar(60) NOT NULL          | Unique live. Allocated from a
                                |                               | system_settings sequence
                                |                               | template (INV-{YYYY}-{seq})
                                |                               | inside the issuing transaction
                                |                               | -- gapless numbering is an
                                |                               | audit expectation in most
                                |                               | jurisdictions.
  contact_id                    | uuid -> contacts.id           | Bill-to person.
  company_id                    | uuid -> contact_companies.id  | Bill-to organization. At least
                                |                               | one of the two is required.
  project_id                    | uuid -> projects.id           |
  issue_date / due_date         | date NOT NULL                 |
  currency                      | varchar(3) NOT NULL           |
  subtotal / tax_total / total  | numeric(20,4) NOT NULL        | Denormalized from line items,
                                |                               | recomputed on every line write
                                |                               | inside the same transaction.
  amount_paid                   | numeric(20,4) default 0       | Sum of payments.
  status                        | invoice_status enum NOT NULL  | draft, sent, partially_paid,
                                | default draft                 | paid, overdue, void
  bill_to_snapshot              | jsonb NOT NULL                | Name, address and tax number
                                |                               | as at issue. A customer that
                                |                               | moves must not retroactively
                                |                               | change an issued invoice.
  notes / terms                 | text                          |
  pdf_file_id                   | uuid -> files.id              | Rendered document.
  sent_at / paid_at / voided_at | timestamptz                   |
  created_by                    | uuid -> users.id              |

    [ ts ]
    uniqueIndex('invoices_number_idx').on(t.number).where(sql`${t.isDeleted} = false`)
    index('invoices_contact_idx').on(t.contactId)
    index('invoices_company_idx').on(t.companyId)
    index('invoices_project_idx').on(t.projectId)
    index('invoices_overdue_idx').on(t.dueDate)
      .where(sql`${t.status} IN ('sent','partially_paid')`)

Immutability rule. Once status <> 'draft', an invoice and its line items are read-only.
Changes are a credit note (a void plus a new invoice). The service enforces this; a
BEFORE UPDATE trigger is the stronger option and is recommended if finance is audited.

12.8 invoice_line_items and payments
------------------------------------

invoice_line_items:

  Column               | Type                         | Notes
  ---------------------+------------------------------+-----------------------------------------
  ...baseColumns       |                              |
  invoice_id           | uuid -> invoices.id NOT NULL | cascade
  description          | varchar(500) NOT NULL        |
  quantity             | numeric(12,4) NOT NULL       | Fractional hours.
  unit                 | varchar(40)                  | hour, day, item.
  unit_price           | numeric(20,4) NOT NULL       |
  tax_rate_pct         | numeric(6,3) default 0       |
  amount               | numeric(20,4) NOT NULL       | quantity x unit_price, stored: rounding
                       |                              | must not vary by reader.
  tax_amount / total   | numeric(20,4)                | Same.
  task_id / project_id | FKs                          | Provenance.
  sort_order           | integer                      |

Billable time reaches an invoice through time_entries.invoice_line_item_id (§10.10):
entries are grouped into a line item, and that FK is what stops the same hour being
billed twice.

payments:

  Column            | Type                                | Notes
  ------------------+-------------------------------------+-------------------------------------
  ...baseColumns    |                                     |
  invoice_id        | uuid -> invoices.id NOT NULL        |
  transaction_id    | uuid -> transactions.id             | The ledger row this payment
                    |                                     | produced.
  amount / currency | numeric(20,4) / varchar(3) NOT NULL | Partial payments are ordinary.
  paid_at           | timestamptz NOT NULL                |
  method            | payment_method enum                 | bank_transfer, card, cash, cheque,
                    |                                     | other
  reference         | varchar(120)                        |
  recorded_by       | uuid -> users.id                    |

    [ ts ]
    index('payments_invoice_idx').on(t.invoiceId)
    uniqueIndex('payments_transaction_idx').on(t.transactionId)
      .where(sql`${t.transactionId} IS NOT NULL AND ${t.isDeleted} = false`)

Recording a payment updates invoices.amount_paid and status in the same transaction. The
unique on transaction_id prevents one ledger row settling two invoices.

12.9 Upgrade path to double-entry
---------------------------------

If statutory bookkeeping is later required, this model is not thrown away: transactions
becomes the document layer and gains journal_entries (header, must balance) +
journal_lines (account_id, debit, credit, with SUM(debit) = SUM(credit) enforced per
entry). Existing transactions are migrated to two-line entries. Deciding this now avoids
that migration; deciding it later is possible but costs a rewrite of every financial
report. Q2 confirmed operational scope, so this stays a documented path rather than
scheduled work.

----------------------------------------------------------------------------------------

========================================================================================
13. SEARCH INTEGRATION
========================================================================================

New entities become searchable through the existing collections + search_records
machinery. No new indexing infrastructure is introduced: the write path is the
transactional persist + index_state outbox + reconciliation sweep already in
SearchRecordService, and each collection is declared by an ensureSystemCollection
bootstrap, exactly as DocumentsCollectionBootstrap does.

13.1 Projection map
-------------------

  Source          | Collection    | Visibility    | Owner field    | Projected fields
  ----------------+---------------+---------------+----------------+----------------------------
  knowledge       | knowledge     | owner_scoped  | aclUserIds     | title, summary, body
                  |               |               |                | (truncated), typeKey,
                  |               |               |                | categoryPath, tagKeys,
                  |               |               |                | status, ownerUserId,
                  |               |               |                | aclUserIds
  projects        | projects      | owner_scoped  | memberUserIds  | key, name, description,
                  |               |               |                | status, priority,
                  |               |               |                | ownerUserId, memberUserIds,
                  |               |               |                | tagKeys
  tasks           | tasks         | owner_scoped  | memberUserIds  | number, title, description,
                  |               |               |                | status, priority,
                  |               |               |                | projectId, projectKey,
                  |               |               |                | assigneeUserId,
                  |               |               |                | memberUserIds, dueDate
  contacts        | contacts      | owner_scoped  | visibleUserIds | displayName, primaryEmail,
                  |               |               |                | companyName, typeKey,
                  |               |               |                | categoryPath, tagKeys,
                  |               |               |                | ownerUserId, visibleUserIds
  files -> chunks | documents     | owner_scoped  | ownerUserId    | exists, unchanged
  email_messages  | inbound_email | as configured | --             | exists, unchanged

13.2 One required change to the search service
----------------------------------------------

Every new collection scopes reads by an array of permitted user ids, not a single owner.
Today validateVisibility in document-validator.ts requires the ownerField to be type ===
'string':

    [ ts ]
    if (spec.type !== 'string') {
      errors.push(`ownerField "${ownerField}" must be of type string (is ${spec.type})`);
    }

FieldSpec already supports 'string[]', and Meilisearch matches field = value against
array attributes by containment. The change is to accept 'string' or 'string[]':

    [ ts ]
    if (spec.type !== 'string' && spec.type !== 'string[]') {
      errors.push(`ownerField "${ownerField}" must be of type string or string[] (is ${spec.type})`);
    }

resolveReadScope needs no change at all -- it already emits { field, userId }, and the
emitted Meili filter aclUserIds = "<uuid>" is correct for both shapes. This is a
three-line change plus a spec case, and it is what lets ACL-scoped search reuse the
enforcement point that already exists rather than growing a second one.

Alternative considered and rejected: adding an acl_scoped value to collectionVisibility.
It duplicates owner_scoped's logic for no behavioural difference, and every future
switch over the enum acquires a redundant branch.

13.3 Keeping the denormalized ACL arrays correct
------------------------------------------------

aclUserIds, memberUserIds and visibleUserIds are denormalizations. They must be
recomputed and re-projected when membership or ACL changes -- not only when the entity
itself changes:

  Change                                        | Reprojects
  ----------------------------------------------+-----------------------------------------
  knowledge_access_control insert/delete/expiry | that knowledge row
  project_members insert/delete                 | that project and all its tasks
  contacts.visibility or owner_user_id change   | that contact
  roles / user_roles change                     | every knowledge row granted to that role

The last two rows are fan-outs and must be queued, not inlined -- a role with a thousand
knowledge grants would otherwise block the request that edited it. Enqueue a
reprojection job on QUEUE_NAMES.searchIndexing; the existing reconciliation sweep is the
safety net if a job is lost.

Accepted risk, stated: ACL propagation is eventually consistent. A revoked grant may
remain visible in search results for seconds. It is not visible in reads -- get()
re-checks the ACL against Postgres, which is why resolveReadScope returns a filter for
search and a comparison for get. Search leaks a title in a result list, never a body. If
even that is unacceptable, the mitigation is to re-check ACL on the result set before
returning it, at the cost of a query per page.

----------------------------------------------------------------------------------------

========================================================================================
14. ACCESS-CONTROL SUMMARY
========================================================================================

One table, because "who can see what" should be answerable without reading eight
sections.

  Resource                | Layer 1 role   | Layer 2 permission       | Layer 3 row scope
  ------------------------+----------------+--------------------------+-------------------------
  System settings,        | admin          | system.settings.manage   | --
  configs, credentials    |                |                          |
  Audit / event logs      | admin          | system.audit.read        | --
  Users, roles, grants    | admin          | user.manage, rbac.manage | --
  Own profile &           | user           | --                       | user_id = self
  preferences             |                |                          |
  Activity feed           | user           | --                       | Whatever the subject
                          |                |                          | entity allows
  Projects                | user           | project.read /           | resolveProjectScope
                          |                | project.manage           | (§10.2)
  Tasks, milestones,      | user           | project.task.*           | Inherited from the
  goals                   |                |                          | project
  Knowledge               | user           | knowledge.read /         | knowledge_access_control
                          |                | knowledge.publish        | + visibility (§9.5)
  Contacts                | user           | contact.read /           | owner_user_id or
                          |                | contact.manage           | visibility = shared
  Notifications (own)     | user           | --                       | recipient_user_id = self
  Notification templates  | admin          | notification.manage      | --
  & event types           |                |                          |
  Financial data          | user           | finance.read /           | Project scope, plus
                          |                | finance.manage           | finance.* permission
  Search over any         | per collection | --                       | resolveReadScope
  collection              |                |                          | (exists)

Agents (service principals) get no implicit access. A service credential reads what its
collection visibility allows and writes only through tools that pass an explicit
principal. Where an agent must act for a user, the run carries that user's id
(agent_run.triggered_by_user_id) and the tool resolves scope as that user -- it does not
borrow admin.

----------------------------------------------------------------------------------------

========================================================================================
15. DECISIONS TAKEN
========================================================================================

Every question this design raised has been answered. Recorded here with what each one
changed, so a later reader can tell a decision from an assumption.

  #  | Question                         | Answer              | What it changed
  ---+----------------------------------+---------------------+---------------------------------
  Q1 | Single-tenant or multi-tenant?   | Single-tenant       | No tenant_id anywhere. Also the
     |                                  |                     | reason teams were dropped (§7.4)
     |                                  |                     | -- a second membership mechanism
     |                                  |                     | does not pay for itself at one
     |                                  |                     | tenant.
  Q2 | Financial scope                  | Operational         | §12 as written: signed
     |                                  |                     | single-entry ledger, invoicing,
     |                                  |                     | no journals. Upgrade path
     |                                  |                     | documented in §12.9 and not
     |                                  |                     | scheduled.
  Q3 | Knowledge revision history?      | No                  | knowledge_revisions not built.
     |                                  |                     | version + activity_log.changes
     |                                  |                     | record that a change happened
     |                                  |                     | and by whom, not the prior body.
  Q4 | Are personal tasks a real        | No                  | tasks.project_id stays NOT NULL,
     | workflow?                        |                     | and the auto-created "personal
     |                                  |                     | project" is gone. One
     |                                  |                     | authorization path, no
     |                                  |                     | exceptions.
  Q5 | Contact deduplication            | Automatic           | contacts.email_normalized with a
     |                                  |                     | partial unique index; write
     |                                  |                     | paths upsert against it (§8.2).
     |                                  |                     | Shared-address consequence
     |                                  |                     | documented there.
  Q6 | Retention windows                | 120 days, uniformly | Eight data_retention_policies
     |                                  |                     | rows seeded at 120 days. Two
     |                                  |                     | ship disabled -- see the warning
     |                                  |                     | below. Also the reason
     |                                  |                     | partitioning was deferred
     |                                  |                     | (§4.7).
  Q7 | May agents create records        | Yes                 | projects.owner_user_id is
     | autonomously?                    |                     | nullable with a
     |                                  |                     | projects_unowned_idx claim
     |                                  |                     | queue; tasks.reporter_user_id,
     |                                  |                     | knowledge.owner_user_id and
     |                                  |                     | contacts.owner_user_id likewise
     |                                  |                     | nullable.

Two retention policies ship disabled, deliberately
--------------------------------------------------

Q6 asked for 120 days on everything, and all eight rows are seeded at 120 days. Two of
them are seeded with enabled = false, because a purge sweep on them would destroy data
rather than trim a log:

  - email_messages is the mailbox archive. mailbox.schema.ts documents it as never
    hard-deleted -- soft-delete is the archive. A 120-day purge would delete stored
    correspondence, including anything a contact interaction or knowledge record cites.
  - search_records is the source of truth behind the Meilisearch read model, not a log.
    Purging live records by age would silently empty search for older content.

The rows exist so the intent is recorded and the window is one edit away; nothing
destructive runs until someone enables them knowingly. Turning either on should be
paired with an export.

========================================================================================
16. DELIVERY PLAN
========================================================================================

Seven phases, each independently shippable behind a feature_flags row, ordered so every
foreign key already exists when it is created. Each phase is: one schema file ->
drizzle-kit generate -> review the generated SQL -> repositories -> services ->
controllers with @Roles + @RequirePermission -> collection bootstrap -> seed -> tests.

The schema for all seven phases has landed in one migration (0013_useful_vanisher,
applied): 57 tables, 51 enums, 143 foreign keys, 62 partial indexes, 4 check
constraints. Tables are cheap and inert; what remains per phase is the code that gives
them behaviour, and that still ships one phase at a time behind its feature_flags row.

  Phase               | Delivers                               | Depends on | Tables | Schema
  --------------------+----------------------------------------+------------+--------+----------
  0. Foundations      | tags, comments, entity_attachments,    | --         | 8      | ✅ applied
                      | activity_log, data_retention_policies, |            |        |
                      | feature_flags, system_event_log,       |            |        |
                      | system_settings extensions,            |            |        |
                      | system_setting_revisions               |            |        |
  1. Identity & Users | roles, permissions, role_permissions,  | 0          | 7      | ✅ applied
                      | user_roles, user_permissions,          |            |        |
                      | user_profiles, user_preferences (+     |            |        |
                      | PermissionsGuard, PermissionResolver,  |            |        |
                      | Redis invalidation)                    |            |        |
  2. CRM              | contact_types, contact_categories,     | 0, 1       | 8      | ✅ applied
                      | contact_companies, contacts,           |            |        |
                      | contact_channels, contact_tags,        |            |        |
                      | contact_relationships,                 |            |        |
                      | contact_interactions                   |            |        |
  3. Knowledge        | knowledge_types, knowledge_categories, | 0, 1, 2    | 6      | ✅ applied
                      | knowledge, knowledge_tags,             |            |        |
                      | knowledge_access_control,              |            |        |
                      | knowledge_contact_links (+ the         |            |        |
                      | validateVisibility change of §13.2)    |            |        |
  4. Projects         | projects, project_members, milestones, | 0-3        | 12     | ✅ applied
                      | tasks, task_dependencies,              |            |        |
                      | task_watchers, goals, project_tags,    |            |        |
                      | task_tags, project_knowledge_links,    |            |        |
                      | project_contact_links, time_entries    |            |        |
  5. Notifications    | notification_event_types,              | 0, 1, 4    | 6      | ✅ applied
                      | notification_templates,                |            |        |
                      | notification_preferences,              |            |        |
                      | notifications,                         |            |        |
                      | notification_delivery_attempts,        |            |        |
                      | notification_suppressions              |            |        |
  6. Finance          | currencies, fx_rates,                  | 0-4        | 10     | ✅ applied
                      | financial_accounts,                    |            |        |
                      | financial_categories, budgets,         |            |        |
                      | transactions, recurring_transactions,  |            |        |
                      | invoices, invoice_line_items, payments |            |        |

Total: 57 new tables.

Seeded alongside the migration (idempotent, re-runnable): 8 currencies, 8 contact types,
8 knowledge types, 14 financial categories, 34 permissions, 7 roles, 45 role-permission
grants, 19 notification event types, 5 templates, 8 retention policies, 7 feature flags.

Ordering rationale. CRM before knowledge and projects because user_profiles.contact_id
and project_contact_links reference it and nothing in CRM references them. Notifications
after projects because the events worth sending are project events. Finance last because
it references projects, tasks, contacts, companies and files -- every one of its
dependencies is already in place.

Per-phase checklist (mirroring what the codebase already enforces):

  1. Schema file added and exported from schema/index.ts; file under 500 lines.
  2. pnpm db:generate; the generated SQL read before it is applied -- partial indexes
     and CHECK constraints are hand-added where drizzle-kit cannot express them (§9.5).
  3. Repositories extend BaseRepository and add their own findLiveById + paginated list.
     No unbounded findAll -- the base class deliberately does not provide one.
  4. Every controller route declares @Roles or @Public (boot assertion already enforces
     this) and, where applicable, @RequirePermission.
  5. src/scripts/check-module-graph.ts passes; the DI validator catches missing module
     exports.
  6. Seed data for lookup tables in infrastructure/database/seeders, idempotent by key.
  7. Search collection bootstrap where §13.1 lists one, with retry, following
     DocumentsCollectionBootstrap.
  8. data_retention_policies row for any append-only or high-volume table added.
  9. Unit tests for scope resolvers with an exhaustive truth table, following
     read-scope.spec.ts; e2e tests for cross-tenant/cross-user isolation, following
     tenancy-isolation.e2e-spec.

----------------------------------------------------------------------------------------

========================================================================================
17. IMPLEMENTATION STATUS
========================================================================================

What exists in the repository as of 2026-09-06.

Schema -- api/src/infrastructure/database/schema/, all re-exported from index.ts:

  File                        | Tables | Covers
  ----------------------------+--------+--------------------------------------------------------
  shared.schema.ts            | 4      | tags, comments, entity_attachments, activity_log
  system.schema.ts (extended) | +4     | setting revisions, event log, retention policies,
                              |        | feature flags, plus 5 columns on system_settings
  rbac.schema.ts              | 5      | permissions, roles and the three grant tables
  profile.schema.ts           | 2      | user_profiles, user_preferences
  project.schema.ts           | 9      | projects, members, milestones, tasks, dependencies,
                              |        | watchers, goals, tags
  contact.schema.ts           | 8      | the CRM
  knowledge.schema.ts         | 6      | knowledge, vocabularies, ACL, contact links
  finance.schema.ts           | 10     | accounts, categories, budgets, ledger, recurring,
                              |        | invoicing
  project-link.schema.ts      | 3      | knowledge/contact references, time entries
  notification.schema.ts      | 6      | event types, templates, preferences, outbox, attempts,
                              |        | suppressions

Migration -- 0013_useful_vanisher.sql, generated by drizzle-kit and applied. Additive
only: CREATE TYPE / CREATE TABLE / CREATE INDEX plus five defaulted columns on
system_settings. No drops, no rewrites, no backfill.

Seeders -- seeders/{reference-data,rbac,notification-catalog,system-policy}.seeder.ts,
registered in seeders/index.ts and run by pnpm seed. All idempotent: a second run
inserts nothing.

Specs -- one *.schema.spec.ts per new schema file, following the existing convention.
They lock the enum vocabularies (order matters to Postgres) and the fail-closed
defaults: projects.visibility, contacts.visibility and knowledge.visibility all default
to private, tasks.project_id is NOT NULL, and the append-only tables have no is_deleted.

Verification -- pnpm typecheck, pnpm lint (no new findings), pnpm test (837 tests, 109
suites), pnpm check:graph, pnpm build all pass.

Not yet built -- every table is inert until a repository, service and controller exist
for it. That work is sequenced in current_implementation_plan.md.

----------------------------------------------------------------------------------------

========================================================================================
18. APPENDIX A -- ENUM CATALOG
========================================================================================

The 51 new pgEnum types, grouped by module. Existing enums (user_role, setting_type,
credential_kind, file_status, search_index_state, collection_visibility, and the agent_*
family) are reused unchanged wherever they fit -- setting_type is reused by
user_preferences, and priority_level is shared by projects, tasks and notifications
rather than duplicated.

  Enum                         | Values
  -----------------------------+----------------------------------------------------------------
  tag_scope                    | knowledge, contact, project, task, shared
  commentable_type             | project, task, goal, milestone, knowledge, contact, invoice
  attachable_type              | project, task, knowledge, contact, contact_company, invoice,
                               | transaction
  attachment_kind              | document, image, receipt, contract, other
  actor_kind                   | user, service, system
  activity_entity_type         | project, task, goal, milestone, knowledge, contact,
                               | contact_company, invoice, user, system
  event_severity               | debug, info, warn, error, critical
  retention_entity_type        | activity_log, system_event_log, notifications,
                               | notification_delivery_attempts, sessions, password_reset_codes,
                               | email_messages, search_records
  retention_action             | purge, anonymize, archive
  permission_effect            | allow, deny
  contact_status               | active, inactive, archived, do_not_contact
  contact_source               | manual, inbound_email, import, referral, website, agent
  contact_visibility           | private, shared
  contact_channel_kind         | email, phone, mobile, fax, website, linkedin, twitter, wechat,
                               | whatsapp, other
  company_size                 | micro, small, medium, large, enterprise
  contact_relationship_type    | colleague, reports_to, manages, spouse, family, friend,
                               | referred_by, introduced_by, advisor_to, other
  relationship_strength        | weak, moderate, strong
  interaction_kind             | email_in, email_out, call, meeting, note, task, other
  interaction_direction        | inbound, outbound, internal
  knowledge_format             | markdown, html, plain, link, file
  knowledge_status             | draft, in_review, published, archived, deprecated
  knowledge_visibility         | private, restricted, internal
  knowledge_permission         | read, comment, write, manage
  grantee_type                 | user, role, authenticated
  project_status               | draft, active, on_hold, completed, archived, cancelled
  project_visibility           | private, internal
  project_member_role          | owner, manager, contributor, viewer
  priority_level               | low, medium, high, urgent
  milestone_status             | pending, in_progress, reached, missed, cancelled
  task_status                  | backlog, todo, in_progress, blocked, in_review, done, cancelled
  dependency_type              | finish_to_start, start_to_start, finish_to_finish,
                               | start_to_finish
  watch_reason                 | manual, assigned, commented, mentioned, reporter
  goal_kind                    | objective, key_result
  goal_status                  | draft, active, at_risk, achieved, missed, cancelled
  goal_direction               | increase, decrease, maintain
  knowledge_relation           | reference, requirement, deliverable, background
  knowledge_contact_relation   | subject, author, source, expert, mentioned
  project_contact_relationship | client, stakeholder, vendor, partner, sponsor, other
  notification_channel         | email
  notification_entity_type     | project, task, goal, milestone, knowledge, contact, invoice,
                               | budget, user, system
  notification_status          | pending, queued, sent, delivered, bounced, failed, suppressed,
                               | cancelled
  notification_frequency       | immediate, hourly, daily, weekly, off
  suppression_reason           | hard_bounce, soft_bounce_repeated, complaint, unsubscribe,
                               | manual, invalid
  account_kind                 | bank, cash, credit_card, receivable, payable, other
  financial_category_kind      | income, expense, transfer
  budget_status                | draft, active, closed, exceeded
  transaction_kind             | income, expense, transfer
  transaction_status           | draft, pending, cleared, reconciled, void
  invoice_status               | draft, sent, partially_paid, paid, overdue, void
  payment_method               | bank_transfer, card, cash, cheque, other
  recurrence_frequency         | weekly, fortnightly, monthly, quarterly, yearly

----------------------------------------------------------------------------------------

========================================================================================
19. APPENDIX B -- DESIGN RULES APPLIED THROUGHOUT
========================================================================================

A checklist for reviewing this design and for reviewing the code that implements it.

  1. Fail closed. Every default visibility is the most restrictive one; every scope
     resolver has a default: return DENY. Adopted from collections.visibility, which was
     made private by default for exactly this reason.
  2. Policy is data, not exceptions. Scope resolvers return a decision object; the
     caller turns it into a SQL predicate or a Meili filter. One truth table, two
     consumers, no divergence.
  3. One enforcement point per question. Ownership, ACLs and permissions each have
     exactly one implementation. Three call sites with three behaviours over one store
     is the failure mode read-scope.ts was written to end.
  4. Partial indexes on the sweep's exact predicate. Every background job's query has an
     index filtered to the rows it selects, so the index size tracks the backlog, not
     the table.
  5. Outbox, not fire-and-forget. Side effects that must survive a crash (search
     projection, email) are rows written in the business transaction and drained by a
     worker with a reconciliation sweep behind it.
  6. Denormalization is declared and rebuildable. progress_pct, spent_minutes,
     current_balance, usage_count, view_count and the ACL arrays are each marked
     non-authoritative with a stated rebuild path.
  7. Append-only means append-only. Logs and audit trails have no is_deleted.
  8. Snapshot what history depends on. bill_to_snapshot, time_entries.hourly_rate,
     notifications.recipient_email, fx_rates -- anything a later edit would
     retroactively rewrite.
  9. Corrections are new rows. Reversing entries, credit notes, tombstoned comments.
     Never a silent overwrite of a settled record.
  10. Idempotency keys everywhere a retry can duplicate. notifications.dedupe_key,
      contact_interactions.email_message_id, (project_id, number) on tasks, (collection,
      external_id) on search records.
