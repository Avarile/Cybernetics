import { UsageError } from '../errors';
import type { ApiClient } from '../http/api.client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shared shape of the `{ data, total, page, limit }` envelope every list endpoint returns. */
interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface ResolveStrategy {
  /** Domain label used in error messages, e.g. 'knowledge'. */
  domain: string;
  /** True when this input looks like something the strategy can resolve. */
  matches: (input: string) => boolean;
  /** Returns candidates; empty means not found. */
  lookup: (input: string, client: ApiClient) => Promise<Array<{ id: string; label: string }>>;
}

/**
 * A disambiguation message exists to be re-entered: every id it prints must
 * itself resolve on the next call, and only a full UUID passes `resolve()`'s
 * UUID-passthrough check. A short id would read cleanly but not be usable.
 */
function ambiguityMessage(
  domain: string,
  input: string,
  candidates: Array<{ id: string; label: string }>,
): string {
  const lines = candidates.map((c) => `  - ${c.label} (${c.id})`).join('\n');
  return (
    `Ambiguous ${domain} address "${input}" matches ${candidates.length} records — ` +
    `retry with one of these ids:\n${lines}`
  );
}

/**
 * Turns a human-typed address ("CYB-42", an email, a slug) into the UUID an
 * endpoint expects.
 *
 * A well-formed UUID passes straight through, without a single HTTP call —
 * the common case for scripted or piped usage. Anything else is resolved via
 * `strategy`, which never guesses: zero matches and two-or-more matches are
 * both a `UsageError`, the latter naming every candidate so the user can
 * retry unambiguously rather than risk editing the wrong record.
 *
 * Never caches. A resolution is only accurate at the moment it is made, and
 * a stale id silently reused would be worse than a repeat request.
 */
export class AddressResolver {
  constructor(private readonly client: ApiClient) {}

  async resolve(input: string, strategy: ResolveStrategy): Promise<string> {
    if (UUID_RE.test(input)) return input;

    if (!strategy.matches(input)) {
      throw new UsageError(`"${input}" is not a valid ${strategy.domain} address.`);
    }

    const candidates = await strategy.lookup(input, this.client);

    if (candidates.length === 0) {
      throw new UsageError(`No ${strategy.domain} matches "${input}".`);
    }
    if (candidates.length > 1) {
      throw new UsageError(ambiguityMessage(strategy.domain, input, candidates));
    }
    return candidates[0].id;
  }
}

// ---------------------------------------------------------------------------
// Concrete strategies
// ---------------------------------------------------------------------------

/** Large enough that a single page covers realistic result sets for these lookups. */
const LIST_PAGE_SIZE = 100;

interface KnowledgeRow {
  id: string;
  slug: string;
  title: string;
}

const KNOWLEDGE_PAGE_WARNING_THRESHOLD = 3;

function toKnowledgeCandidates(
  rows: KnowledgeRow[],
  input: string,
): Array<{ id: string; label: string }> {
  // Exact equality only: a near-miss slug (another record's slug that merely
  // contains this one) must never be selected — this command goes on to edit
  // whatever it resolves to.
  return rows
    .filter((row) => row.slug === input)
    .map((row) => ({ id: row.id, label: `${row.slug} — ${row.title}` }));
}

/**
 * `/knowledge` has no `slug` filter — only `search`, which matches title and
 * summary — and slugs are dash-derived from titles, so searching for the
 * slug text itself (dashes and all) would almost never match.
 *
 * Fast path: replace dashes with spaces and use `search`, which resolves a
 * title-derived slug in one request (the common case). Fallback: a slug that
 * doesn't derive cleanly from a `search`-visible title — paging the full
 * list and matching exactly, client-side, the same shape as
 * `taskByProjectAndNumber`'s unavoidable pagination. Warns once past 3 pages
 * so the cost is visible rather than silently degrading as records grow.
 */
export const knowledgeBySlug: ResolveStrategy = {
  domain: 'knowledge',
  matches: () => true,
  async lookup(input, client) {
    const searchTerm = input.replace(/-/g, ' ');
    const fast = await client.get<Paginated<KnowledgeRow>>(
      `/knowledge?search=${encodeURIComponent(searchTerm)}&limit=${LIST_PAGE_SIZE}`,
    );
    const fastMatches = toKnowledgeCandidates(fast.data, input);
    if (fastMatches.length > 0) return fastMatches;

    let warned = false;
    for (let page = 1; ; page++) {
      const res = await client.get<Paginated<KnowledgeRow>>(
        `/knowledge?page=${page}&limit=${LIST_PAGE_SIZE}`,
      );

      if (page > KNOWLEDGE_PAGE_WARNING_THRESHOLD && !warned) {
        process.stderr.write(
          `warning: resolving "${input}" is paging the knowledge list (page ${page}) — ` +
            `this scales linearly with the number of records\n`,
        );
        warned = true;
      }

      const matches = toKnowledgeCandidates(res.data, input);
      if (matches.length > 0) return matches;
      if (res.data.length < LIST_PAGE_SIZE) return [];
    }
  },
};

interface ContactRow {
  id: string;
  displayName: string;
  primaryEmail: string | null;
}

/** `/contacts?search=` already matches displayName or primaryEmail by substring server-side. */
export const contactByEmailOrName: ResolveStrategy = {
  domain: 'contact',
  matches: () => true,
  async lookup(input, client) {
    const res = await client.get<Paginated<ContactRow>>(
      `/contacts?search=${encodeURIComponent(input)}&limit=${LIST_PAGE_SIZE}`,
    );
    return res.data.map((row) => ({
      id: row.id,
      label: row.primaryEmail ? `${row.displayName} <${row.primaryEmail}>` : row.displayName,
    }));
  },
};

const PROJECT_KEY_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

interface ProjectRow {
  id: string;
  key: string;
  name: string;
}

/**
 * `/projects?search=` matches name or key by substring, so an exact,
 * case-insensitive key match is applied client-side to the results.
 */
async function lookupProjectByKey(
  key: string,
  client: ApiClient,
): Promise<Array<{ id: string; label: string }>> {
  const res = await client.get<Paginated<ProjectRow>>(
    `/projects?search=${encodeURIComponent(key)}&limit=${LIST_PAGE_SIZE}`,
  );
  return res.data
    .filter((row) => row.key.toLowerCase() === key.toLowerCase())
    .map((row) => ({ id: row.id, label: `${row.key} — ${row.name}` }));
}

export const projectByKey: ResolveStrategy = {
  domain: 'project',
  matches: (input) => PROJECT_KEY_RE.test(input),
  lookup: (input, client) => lookupProjectByKey(input, client),
};

const TASK_ADDRESS_RE = /^([A-Za-z][A-Za-z0-9_]*)-(\d+)$/;
/** Kept modest (well under the API's max of 100) so a large project pages visibly rather than in one giant fetch. */
const TASK_LIST_PAGE_SIZE = 25;
/** `taskByProjectAndNumber` is the one address that can't be resolved without paging: see the warning below. */
const TASK_PAGE_WARNING_THRESHOLD = 3;

interface TaskRow {
  id: string;
  number: number;
  title: string;
  projectId: string;
}

/**
 * Parses "CYB-42" (case-insensitively) into a project key and a task number.
 *
 * `listTasksSchema` has no `number` filter, so this resolves the project by
 * key first, then pages `/tasks?projectId=…` matching `number` client-side —
 * the one address in this module that can't be resolved in a single request.
 * Silence here would let the cost degrade invisibly as a project grows, so a
 * resolution that pages more than a few times warns once on stderr.
 */
export const taskByProjectAndNumber: ResolveStrategy = {
  domain: 'task',
  matches: (input) => TASK_ADDRESS_RE.test(input),
  async lookup(input, client) {
    const match = TASK_ADDRESS_RE.exec(input);
    if (!match) return [];
    const [, key, numberText] = match;
    const number = Number(numberText);

    const projects = await lookupProjectByKey(key, client);
    if (projects.length === 0) {
      throw new UsageError(`No project matches key "${key}" (from task address "${input}").`);
    }
    if (projects.length > 1) {
      throw new UsageError(ambiguityMessage('project', key, projects));
    }
    const projectId = projects[0].id;

    let warned = false;
    for (let page = 1; ; page++) {
      const res = await client.get<Paginated<TaskRow>>(
        `/tasks?projectId=${projectId}&page=${page}&limit=${TASK_LIST_PAGE_SIZE}`,
      );

      if (page > TASK_PAGE_WARNING_THRESHOLD && !warned) {
        process.stderr.write(
          `warning: resolving "${input}" is paging the tasks list (page ${page}) — ` +
            `this scales linearly with project size\n`,
        );
        warned = true;
      }

      const found = res.data.find((row) => row.number === number);
      if (found) {
        return [{ id: found.id, label: `${key.toUpperCase()}-${number} — ${found.title}` }];
      }
      if (res.data.length < TASK_LIST_PAGE_SIZE) return [];
    }
  },
};

/** `invoiceByNumber` is the one address, alongside `taskByProjectAndNumber`, that can't avoid paging. */
const INVOICE_PAGE_WARNING_THRESHOLD = 3;

interface InvoiceRow {
  id: string;
  number: string;
}

/**
 * `listInvoicesSchema` (api/src/features/finance/dto/finance.dto.ts) takes
 * `status`/`contactId`/`companyId`/`projectId`/`page`/`limit` — no `number`
 * and no `search` — so, unlike `contactByEmailOrName`, there is no
 * server-side filter to lean on. This pages the full list client-side and
 * matches `number` exactly, the same shape `taskByProjectAndNumber` uses for
 * its own unavoidable pagination, warning past a few pages for the same
 * reason.
 *
 * `matches` accepts anything (like `knowledgeBySlug`/`contactByEmailOrName`)
 * rather than a format regex: an unissued invoice's `number` is a
 * `DRAFT-<timestamp>` placeholder (`InvoiceService.create`, invoice.service.ts)
 * until `issue` allocates the real `INV-<year>-<seq>` one
 * (`InvoiceService.issue`) — both are exactly what `invoices ls` shows in its
 * NUMBER column, and both need to resolve, including from `line add` and
 * `bill-time`, which operate on drafts specifically.
 */
export const invoiceByNumber: ResolveStrategy = {
  domain: 'invoice',
  matches: () => true,
  async lookup(input, client) {
    let warned = false;
    for (let page = 1; ; page++) {
      const res = await client.get<Paginated<InvoiceRow>>(
        `/invoices?page=${page}&limit=${LIST_PAGE_SIZE}`,
      );

      if (page > INVOICE_PAGE_WARNING_THRESHOLD && !warned) {
        process.stderr.write(
          `warning: resolving "${input}" is paging the invoices list (page ${page}) — ` +
            `this scales linearly with the number of records\n`,
        );
        warned = true;
      }

      const matches = res.data
        .filter((row) => row.number === input)
        .map((row) => ({ id: row.id, label: row.number }));
      if (matches.length > 0) return matches;
      if (res.data.length < LIST_PAGE_SIZE) return [];
    }
  },
};
