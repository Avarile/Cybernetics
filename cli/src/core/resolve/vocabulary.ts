import { ApiError, UsageError } from '../errors';
import type { ApiClient } from '../http/api.client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shared shape of the `{ data, total, page, limit }` envelope every list endpoint returns. */
interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export type VocabularyKind =
  | 'contact-type'
  | 'contact-category'
  | 'knowledge-type'
  | 'knowledge-category'
  | 'tag'
  | 'company';

export type TagScope = 'knowledge' | 'contact' | 'project' | 'task' | 'shared';

/** One buffer field that carries keys rather than ids. */
export interface KeyBackedField {
  /** What the user sees, e.g. 'type'. */
  bufferField: string;
  /** What the API takes, e.g. 'typeId'. */
  dtoField: string;
  /** Tags are a list; type/category/company are not. */
  many: boolean;
  kind: VocabularyKind;
  /** Required when kind === 'tag' — the field's own scope, searched before the `shared` fallback. */
  scope?: TagScope;
}

/**
 * THE single declaration of which buffer fields are key-backed, across both
 * groups that have them. Task 4 (template rendering) and Task 5 (submit
 * wiring) both consume this — neither should grow its own copy of "which
 * fields are key-backed", or that knowledge scatters into every command.
 *
 * Sourced from `CreateContactDto`/`UpdateContactDto`
 * (api/src/features/contacts/dto/contact.dto.ts) and
 * `CreateKnowledgeDto`/`UpdateKnowledgeDto`
 * (api/src/features/knowledge/dto/knowledge.dto.ts): both carry
 * `typeId`/`categoryId`/`tagIds`; only contact also carries `companyId` —
 * knowledge articles have no company field.
 */
export const KEY_BACKED_FIELDS: Record<'contact' | 'knowledge', KeyBackedField[]> = {
  contact: [
    { bufferField: 'type', dtoField: 'typeId', many: false, kind: 'contact-type' },
    { bufferField: 'category', dtoField: 'categoryId', many: false, kind: 'contact-category' },
    { bufferField: 'tags', dtoField: 'tagIds', many: true, kind: 'tag', scope: 'contact' },
    { bufferField: 'company', dtoField: 'companyId', many: false, kind: 'company' },
  ],
  knowledge: [
    { bufferField: 'type', dtoField: 'typeId', many: false, kind: 'knowledge-type' },
    { bufferField: 'category', dtoField: 'categoryId', many: false, kind: 'knowledge-category' },
    { bufferField: 'tags', dtoField: 'tagIds', many: true, kind: 'tag', scope: 'knowledge' },
  ],
};

// ---------------------------------------------------------------------------
// Bounded vocabularies: contact/knowledge types and categories.
// ---------------------------------------------------------------------------

type BoundedKind = 'contact-type' | 'contact-category' | 'knowledge-type' | 'knowledge-category';

/**
 * One record shape shared by contact/knowledge types and categories — see
 * `VocabRecord` in `src/commands/vocabulary/vocabulary-crud.ts`. Only `id`
 * and `key` matter for resolution; the rest passes through untouched
 * wherever a caller renders the full record.
 */
interface BoundedRecord {
  id: string;
  key: string;
  [extra: string]: unknown;
}

interface BoundedConfig {
  /** `GET` returns a plain array, unpaginated — confirmed against operations.ts:
   *  none of {Contact,Knowledge}VocabularyController's list* endpoints take page/limit. */
  basePath: string;
  /** Human label used in error messages, e.g. 'contact type'. */
  label: string;
  /** The discovery command (Task 2/3) that lists every key of this kind. */
  lsCommand: string;
}

const BOUNDED_CONFIGS: Record<BoundedKind, BoundedConfig> = {
  'contact-type': {
    basePath: '/contact-vocabulary/types',
    label: 'contact type',
    lsCommand: 'cyb contacts type ls',
  },
  'contact-category': {
    basePath: '/contact-vocabulary/categories',
    label: 'contact category',
    lsCommand: 'cyb contacts category ls',
  },
  'knowledge-type': {
    basePath: '/knowledge-vocabulary/types',
    label: 'knowledge type',
    lsCommand: 'cyb knowledge type ls',
  },
  'knowledge-category': {
    basePath: '/knowledge-vocabulary/categories',
    label: 'knowledge category',
    lsCommand: 'cyb knowledge category ls',
  },
};

/**
 * Builds the "unknown key" `UsageError`: up to 10 valid keys, then a count of
 * the remainder, then the command that shows them all. The message is the
 * fix, not just a complaint.
 */
function unknownKeyError(label: string, lsCommand: string, value: string, keys: string[]): UsageError {
  const unique = Array.from(new Set(keys));
  const shown = unique.slice(0, 10);
  const remainder = unique.length - shown.length;

  const parts = [`Unknown ${label} key "${value}".`];
  if (shown.length > 0) {
    parts.push(`Valid keys: ${shown.join(', ')}.`);
    if (remainder > 0) parts.push(`(${remainder} more not shown.)`);
  } else {
    parts.push('No keys exist yet.');
  }
  parts.push(`See: ${lsCommand}`);
  return new UsageError(parts.join(' '));
}

// ---------------------------------------------------------------------------
// Tags: scope-aware, bounded per scope.
// ---------------------------------------------------------------------------

/** `PublicTag` — see `TagRecord` in `src/commands/tags/tags.helpers.ts`. */
interface TagRow {
  id: string;
  key: string;
  scope: TagScope;
  [extra: string]: unknown;
}

/** Large enough that a scope's tags (small, bounded) come back in one or two pages. */
const TAG_PAGE_SIZE = 100;

/** `contact:security` / `shared:security` — the disambiguating form offered on a two-scope hit. */
const SCOPE_KEY_RE = /^(knowledge|contact|project|task|shared):(.+)$/;

// ---------------------------------------------------------------------------
// Companies: unbounded, name-only, never fully indexed.
// ---------------------------------------------------------------------------

/** Only `id`/`name` matter for resolution — see `CompanyRecord` in `src/commands/companies/companies.helpers.ts`. */
interface CompanyRow {
  id: string;
  name: string;
  [extra: string]: unknown;
}

/** `listCompaniesSchema`'s max (`company.dto.ts`) — the largest single page `/companies` allows. */
const COMPANY_SEARCH_PAGE_SIZE = 100;
/** Past this many pages of a single search term, paging is made visible rather than silent. */
const COMPANY_PAGE_WARNING_THRESHOLD = 3;

function companyAmbiguityError(value: string, candidates: CompanyRow[]): UsageError {
  const lines = candidates.map((c) => `  - ${c.name} (${c.id})`).join('\n');
  return new UsageError(
    `Ambiguous company name "${value}" matches ${candidates.length} companies — ` +
      `retype with one of these ids:\n${lines}`,
  );
}

/**
 * Turns a human-typed key into the UUID a create/update DTO expects, and back
 * again for rendering an edit buffer.
 *
 * A well-formed UUID passes `toId` straight through, with no HTTP call at
 * all — the guaranteed escape hatch when a key is ambiguous or missing.
 *
 * Bounded vocabularies (contact/knowledge types and categories, and tags per
 * scope) are fetched at most once per `VocabularyIndex` instance and indexed
 * both directions; two lookups of the same kind (and, for tags, the same
 * scope) cost one request. Companies are unbounded and are never fully
 * indexed: `toId` narrows via `?search=` and requires an exact name match
 * client-side (VERIFIED against `contact-company.repository.ts`: `search` is
 * `ilike` against `name` alone, and `listCompaniesSchema` has no `domain`
 * filter — domain is display-only), and `toKey` fetches the single company
 * by id.
 *
 * Nothing is cached across instances — construct one per command invocation.
 */
export class VocabularyIndex {
  private readonly boundedCache = new Map<BoundedKind, Promise<BoundedRecord[]>>();
  private readonly tagCache = new Map<TagScope, Promise<TagRow[]>>();

  constructor(private readonly client: ApiClient) {}

  /** Throws `UsageError` (exit 2) listing up to 10 valid keys on a miss. */
  async toId(field: KeyBackedField, value: string): Promise<string> {
    if (UUID_RE.test(value)) return value;

    if (field.kind === 'tag') return this.tagToId(field, value);
    if (field.kind === 'company') return this.companyToId(value);
    return this.boundedToId(field.kind, value);
  }

  /** id -> key for rendering an edit buffer. Returns the raw id if unresolvable. */
  async toKey(field: KeyBackedField, id: string): Promise<string> {
    if (field.kind === 'tag') return this.tagToKey(field, id);
    if (field.kind === 'company') return this.companyToKey(id);
    return this.boundedToKey(field.kind, id);
  }

  /** Batch form for `many` fields (tags). */
  toIds(field: KeyBackedField, values: string[]): Promise<string[]> {
    return Promise.all(values.map((value) => this.toId(field, value)));
  }

  toKeys(field: KeyBackedField, ids: string[]): Promise<string[]> {
    return Promise.all(ids.map((id) => this.toKey(field, id)));
  }

  // --- bounded: contact/knowledge type/category -----------------------------

  private loadBounded(kind: BoundedKind): Promise<BoundedRecord[]> {
    let promise = this.boundedCache.get(kind);
    if (!promise) {
      promise = this.client.get<BoundedRecord[]>(BOUNDED_CONFIGS[kind].basePath);
      this.boundedCache.set(kind, promise);
    }
    return promise;
  }

  private async boundedToId(kind: BoundedKind, value: string): Promise<string> {
    const records = await this.loadBounded(kind);
    const match = records.find((r) => r.key === value);
    if (!match) {
      const { label, lsCommand } = BOUNDED_CONFIGS[kind];
      throw unknownKeyError(
        label,
        lsCommand,
        value,
        records.map((r) => r.key),
      );
    }
    return match.id;
  }

  private async boundedToKey(kind: BoundedKind, id: string): Promise<string> {
    const records = await this.loadBounded(kind);
    return records.find((r) => r.id === id)?.key ?? id;
  }

  // --- tags: scope-aware ------------------------------------------------

  private loadTags(scope: TagScope): Promise<TagRow[]> {
    let promise = this.tagCache.get(scope);
    if (!promise) {
      promise = this.fetchAllTags(scope);
      this.tagCache.set(scope, promise);
    }
    return promise;
  }

  private async fetchAllTags(scope: TagScope): Promise<TagRow[]> {
    const all: TagRow[] = [];
    for (let page = 1; ; page++) {
      const res = await this.client.get<Paginated<TagRow>>(
        `/tags?scope=${scope}&page=${page}&limit=${TAG_PAGE_SIZE}`,
      );
      all.push(...res.data);
      if (res.data.length < TAG_PAGE_SIZE) break;
    }
    return all;
  }

  private async tagToId(field: KeyBackedField, value: string): Promise<string> {
    const fieldScope = field.scope;
    if (!fieldScope) {
      // A `kind: 'tag'` entry without a `scope` is a bug in whoever built the
      // `KeyBackedField`, not a user mistake — `KEY_BACKED_FIELDS` is the one
      // place these are declared, and both entries there set `scope`.
      throw new Error('KeyBackedField of kind "tag" must declare a scope.');
    }

    const explicit = SCOPE_KEY_RE.exec(value);
    if (explicit) {
      const [, scope, key] = explicit;
      const tags = await this.loadTags(scope as TagScope);
      const match = tags.find((t) => t.key === key);
      if (!match) {
        throw unknownKeyError(
          'tag',
          `cyb tags ls --scope ${scope}`,
          key,
          tags.map((t) => t.key),
        );
      }
      return match.id;
    }

    const domainTags = await this.loadTags(fieldScope);
    const domainMatch = domainTags.find((t) => t.key === value);

    if (fieldScope === 'shared') {
      if (!domainMatch) {
        throw unknownKeyError(
          'tag',
          `cyb tags ls --scope ${fieldScope}`,
          value,
          domainTags.map((t) => t.key),
        );
      }
      return domainMatch.id;
    }

    const sharedTags = await this.loadTags('shared');
    const sharedMatch = sharedTags.find((t) => t.key === value);

    if (domainMatch && sharedMatch) {
      throw new UsageError(
        `Tag key "${value}" is ambiguous: it exists in both the "${fieldScope}" and "shared" scopes. ` +
          `Retype it as "${fieldScope}:${value}" or "shared:${value}" to pick one.`,
      );
    }
    if (domainMatch) return domainMatch.id;
    if (sharedMatch) return sharedMatch.id;

    throw unknownKeyError('tag', `cyb tags ls --scope ${fieldScope}`, value, [
      ...domainTags.map((t) => t.key),
      ...sharedTags.map((t) => t.key),
    ]);
  }

  private async tagToKey(field: KeyBackedField, id: string): Promise<string> {
    const fieldScope = field.scope;
    if (!fieldScope) {
      throw new Error('KeyBackedField of kind "tag" must declare a scope.');
    }

    const domainTags = await this.loadTags(fieldScope);
    const domainMatch = domainTags.find((t) => t.id === id);
    if (domainMatch) return domainMatch.key;

    if (fieldScope !== 'shared') {
      const sharedTags = await this.loadTags('shared');
      const sharedMatch = sharedTags.find((t) => t.id === id);
      if (sharedMatch) return sharedMatch.key;
    }

    return id;
  }

  // --- companies: unbounded, name-only ------------------------------------

  private async companyToId(value: string): Promise<string> {
    const exact: CompanyRow[] = [];
    let warned = false;

    for (let page = 1; ; page++) {
      const res = await this.client.get<Paginated<CompanyRow>>(
        `/companies?search=${encodeURIComponent(value)}&page=${page}&limit=${COMPANY_SEARCH_PAGE_SIZE}`,
      );

      if (page > COMPANY_PAGE_WARNING_THRESHOLD && !warned) {
        process.stderr.write(
          `warning: resolving company "${value}" is paging the companies list (page ${page}) — ` +
            `this scales linearly with the number of matching names\n`,
        );
        warned = true;
      }

      exact.push(...res.data.filter((c) => c.name === value));
      if (res.data.length < COMPANY_SEARCH_PAGE_SIZE) break;
    }

    if (exact.length === 0) {
      throw new UsageError(
        `No company named exactly "${value}" (search is a narrowing device, not a matcher — ` +
          `a substring hit is never silently accepted). See: cyb companies ls --search "${value}"`,
      );
    }
    if (exact.length > 1) {
      throw companyAmbiguityError(value, exact);
    }
    return exact[0].id;
  }

  private async companyToKey(id: string): Promise<string> {
    try {
      const company = await this.client.get<CompanyRow>(`/companies/${id}`);
      return company.name;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return id;
      throw err;
    }
  }
}
