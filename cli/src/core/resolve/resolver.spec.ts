import type { ApiClient } from '../http/api.client';
import { UsageError } from '../errors';
import {
  AddressResolver,
  contactByEmailOrName,
  invoiceByNumber,
  knowledgeBySlug,
  projectByKey,
  taskByProjectAndNumber,
  type ResolveStrategy,
} from './resolver';

const UUID = '11111111-2222-3333-4444-555555555555';

function client(get: jest.Mock): ApiClient {
  return { get } as unknown as ApiClient;
}

function fixtureStrategy(candidates: Array<{ id: string; label: string }>): ResolveStrategy {
  return {
    domain: 'widget',
    matches: () => true,
    lookup: async () => candidates,
  };
}

/** `promise.catch((e) => e)` widens to `T | Error`; this keeps the rejection typed as `Error`. */
async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected the promise to reject, but it resolved');
}

describe('AddressResolver.resolve — generic behaviour', () => {
  it('passes a well-formed UUID through unchanged, without any HTTP call', async () => {
    const get = jest.fn();
    const resolver = new AddressResolver(client(get));

    const result = await resolver.resolve(UUID, fixtureStrategy([]));

    expect(result).toBe(UUID);
    expect(get).not.toHaveBeenCalled();
  });

  it('returns the id of a single candidate', async () => {
    const resolver = new AddressResolver(client(jest.fn()));
    const result = await resolver.resolve(
      'not-a-uuid',
      fixtureStrategy([{ id: 'abc-1', label: 'Only One' }]),
    );
    expect(result).toBe('abc-1');
  });

  it('throws UsageError (exit 2) naming the domain and input on zero candidates', async () => {
    const resolver = new AddressResolver(client(jest.fn()));
    const strategy = fixtureStrategy([]);

    await expect(resolver.resolve('nope', strategy)).rejects.toThrow(UsageError);
    await expect(resolver.resolve('nope', strategy)).rejects.toMatchObject({ exitCode: 2 });

    const err = await rejectionOf(resolver.resolve('nope', strategy));
    expect(err.message).toContain('widget');
    expect(err.message).toContain('nope');
  });

  it('throws UsageError listing every candidate label and short id on ambiguity, never guessing', async () => {
    const resolver = new AddressResolver(client(jest.fn()));
    const strategy = fixtureStrategy([
      { id: '11111111-aaaa-bbbb-cccc-111111111111', label: 'Alpha' },
      { id: '22222222-aaaa-bbbb-cccc-222222222222', label: 'Beta' },
    ]);

    await expect(resolver.resolve('ambiguous', strategy)).rejects.toThrow(UsageError);

    const err = await rejectionOf(resolver.resolve('ambiguous', strategy));
    expect(err.message).toContain('Alpha');
    expect(err.message).toContain('11111111');
    expect(err.message).toContain('Beta');
    expect(err.message).toContain('22222222');
  });

  it('lists FULL ids (not short ids) on ambiguity, so each candidate can be retried directly', async () => {
    const resolver = new AddressResolver(client(jest.fn()));
    const candidateIds = [
      '11111111-aaaa-bbbb-cccc-111111111111',
      '22222222-aaaa-bbbb-cccc-222222222222',
    ];
    const strategy = fixtureStrategy([
      { id: candidateIds[0], label: 'Alpha' },
      { id: candidateIds[1], label: 'Beta' },
    ]);

    const err = await rejectionOf(resolver.resolve('ambiguous', strategy));
    expect(err.message).toContain(candidateIds[0]);
    expect(err.message).toContain(candidateIds[1]);

    // A disambiguation prompt exists to be re-entered: every id it prints
    // must itself pass straight through `resolve()` as a UUID.
    for (const id of candidateIds) {
      await expect(resolver.resolve(id, strategy)).resolves.toBe(id);
    }
  });
});

describe('knowledgeBySlug', () => {
  it('resolves a unique slug match', async () => {
    const get = jest.fn().mockResolvedValue({
      data: [{ id: 'k-1', slug: 'getting-started', title: 'Getting Started' }],
      total: 1,
      page: 1,
      limit: 100,
    });
    const resolver = new AddressResolver(client(get));

    await expect(resolver.resolve('getting-started', knowledgeBySlug)).resolves.toBe('k-1');
  });

  it('does not match a slug substring another record merely contains', async () => {
    const get = jest.fn().mockResolvedValue({
      data: [{ id: 'k-1', slug: 'getting-started-fast', title: 'Fast Start' }],
      total: 1,
      page: 1,
      limit: 100,
    });
    const resolver = new AddressResolver(client(get));

    await expect(resolver.resolve('getting-started', knowledgeBySlug)).rejects.toThrow(
      UsageError,
    );
  });

  it('resolves via the fast path (search on dashes-replaced-by-spaces) in a single request', async () => {
    const get = jest.fn().mockResolvedValue({
      data: [{ id: 'k-1', slug: 'auth-token-rotation', title: 'Auth token rotation' }],
      total: 1,
      page: 1,
      limit: 100,
    });
    const resolver = new AddressResolver(client(get));

    await expect(resolver.resolve('auth-token-rotation', knowledgeBySlug)).resolves.toBe('k-1');
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toContain(encodeURIComponent('auth token rotation'));
  });

  it('never selects a near-miss slug the fast-path search happens to return', async () => {
    // Every response — fast path and fallback alike — offers only a
    // similarly-named record, never an exact match anywhere.
    const get = jest.fn().mockResolvedValue({
      data: [{ id: 'k-wrong', slug: 'auth-tokens-explained', title: 'Auth Tokens Explained' }],
      total: 1,
      page: 1,
      limit: 100,
    });
    const resolver = new AddressResolver(client(get));

    await expect(resolver.resolve('auth-tokens', knowledgeBySlug)).rejects.toThrow(UsageError);
  });

  it('falls back to full pagination when the fast path misses, and matches exactly there', async () => {
    const get = jest.fn(async (path: string) => {
      if (path.includes('search=')) {
        return { data: [], total: 0, page: 1, limit: 100 }; // fast path: nothing
      }
      const url = new URL(`http://x${path}`);
      const page = Number(url.searchParams.get('page'));
      if (page === 1) {
        // A full page (length === limit) signals "there may be more" and
        // keeps the fallback paging into page 2.
        return {
          data: Array.from({ length: 100 }, (_, i) => ({
            id: `k-filler-${i}`,
            slug: `something-else-${i}`,
            title: 'Something Else',
          })),
          total: 101,
          page,
          limit: 100,
        };
      }
      return {
        data: [{ id: 'k-2', slug: 'legacy-slug', title: 'Weirdly Named Article' }],
        total: 101,
        page,
        limit: 100,
      };
    });
    const resolver = new AddressResolver(client(get));

    await expect(resolver.resolve('legacy-slug', knowledgeBySlug)).resolves.toBe('k-2');
    expect(get).toHaveBeenCalledTimes(3); // 1 fast-path search + 2 fallback pages
  });

  it('throws UsageError when the slug exists nowhere, fast path or fallback', async () => {
    const get = jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 100 });
    const resolver = new AddressResolver(client(get));

    await expect(resolver.resolve('does-not-exist', knowledgeBySlug)).rejects.toThrow(
      UsageError,
    );
  });

  it('emits a stderr warning once fallback pagination exceeds 3 pages', async () => {
    const get = jest.fn(async (path: string) => {
      if (path.includes('search=')) {
        return { data: [], total: 0, page: 1, limit: 100 }; // fast path: nothing
      }
      const url = new URL(`http://x${path}`);
      const page = Number(url.searchParams.get('page'));
      const limit = Number(url.searchParams.get('limit'));
      if (page < 5) {
        return {
          data: Array.from({ length: limit }, (_, i) => ({
            id: `k-${page}-${i}`,
            slug: `filler-${page}-${i}`,
            title: 'Filler',
          })),
          total: 1000,
          page,
          limit,
        };
      }
      return {
        data: [{ id: 'k-found', slug: 'target-slug', title: 'Target' }],
        total: 1000,
        page,
        limit,
      };
    });
    const resolver = new AddressResolver(client(get));
    const warnSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(resolver.resolve('target-slug', knowledgeBySlug)).resolves.toBe('k-found');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

describe('contactByEmailOrName', () => {
  it('resolves a unique email match', async () => {
    const get = jest.fn().mockResolvedValue({
      data: [{ id: 'c-1', displayName: 'Ada Lovelace', primaryEmail: 'ada@example.com' }],
      total: 1,
      page: 1,
      limit: 20,
    });
    const resolver = new AddressResolver(client(get));

    await expect(resolver.resolve('ada@example.com', contactByEmailOrName)).resolves.toBe('c-1');
  });

  it('is ambiguous when the search returns more than one contact', async () => {
    const get = jest.fn().mockResolvedValue({
      data: [
        { id: 'c-1', displayName: 'Ada Lovelace', primaryEmail: 'ada@example.com' },
        { id: 'c-2', displayName: 'Ada Byron', primaryEmail: null },
      ],
      total: 2,
      page: 1,
      limit: 20,
    });
    const resolver = new AddressResolver(client(get));

    const err = await rejectionOf(resolver.resolve('Ada', contactByEmailOrName));
    expect(err).toBeInstanceOf(UsageError);
    expect(err.message).toContain('Ada Lovelace');
    expect(err.message).toContain('Ada Byron');
  });
});

describe('projectByKey', () => {
  it('filters search results to an exact, case-insensitive key match', async () => {
    const get = jest.fn().mockResolvedValue({
      data: [
        { id: 'p-1', key: 'CYB', name: 'Cybernetics' },
        { id: 'p-2', key: 'CYBORG', name: 'Not this one' },
      ],
      total: 2,
      page: 1,
      limit: 100,
    });
    const resolver = new AddressResolver(client(get));

    await expect(resolver.resolve('cyb', projectByKey)).resolves.toBe('p-1');
  });

  it('rejects an input that cannot be a project key, without any HTTP call', async () => {
    const get = jest.fn();
    const resolver = new AddressResolver(client(get));

    await expect(resolver.resolve('not a key!', projectByKey)).rejects.toThrow(UsageError);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('taskByProjectAndNumber', () => {
  it('parses "CYB-42", resolves the project by key, then the task by number', async () => {
    const get = jest.fn(async (path: string) => {
      if (path.startsWith('/projects')) {
        return {
          data: [{ id: 'proj-1', key: 'CYB', name: 'Cybernetics' }],
          total: 1,
          page: 1,
          limit: 100,
        };
      }
      return {
        data: [{ id: 'task-42', number: 42, title: 'Fix it', projectId: 'proj-1' }],
        total: 1,
        page: 1,
        limit: 25,
      };
    });
    const resolver = new AddressResolver(client(get));

    await expect(resolver.resolve('CYB-42', taskByProjectAndNumber)).resolves.toBe('task-42');
  });

  it('parses a lowercase address ("cyb-42") the same way', async () => {
    const get = jest.fn(async (path: string) => {
      if (path.startsWith('/projects')) {
        return {
          data: [{ id: 'proj-1', key: 'CYB', name: 'Cybernetics' }],
          total: 1,
          page: 1,
          limit: 100,
        };
      }
      return {
        data: [{ id: 'task-42', number: 42, title: 'Fix it', projectId: 'proj-1' }],
        total: 1,
        page: 1,
        limit: 25,
      };
    });
    const resolver = new AddressResolver(client(get));

    await expect(resolver.resolve('cyb-42', taskByProjectAndNumber)).resolves.toBe('task-42');
  });

  it('rejects a malformed address ("CYB-") as a usage error, without any HTTP call', async () => {
    const get = jest.fn();
    const resolver = new AddressResolver(client(get));

    await expect(resolver.resolve('CYB-', taskByProjectAndNumber)).rejects.toThrow(UsageError);
    expect(get).not.toHaveBeenCalled();
  });

  it('rejects a malformed address ("CYB-abc") as a usage error, without any HTTP call', async () => {
    const get = jest.fn();
    const resolver = new AddressResolver(client(get));

    await expect(resolver.resolve('CYB-abc', taskByProjectAndNumber)).rejects.toThrow(UsageError);
    expect(get).not.toHaveBeenCalled();
  });

  it('emits a stderr warning once resolution pages the tasks list more than 3 times', async () => {
    const get = jest.fn(async (path: string) => {
      if (path.startsWith('/projects')) {
        return {
          data: [{ id: 'proj-1', key: 'CYB', name: 'Cybernetics' }],
          total: 1,
          page: 1,
          limit: 100,
        };
      }
      const url = new URL(`http://x${path}`);
      const page = Number(url.searchParams.get('page'));
      const limit = Number(url.searchParams.get('limit'));
      if (page < 5) {
        return {
          data: Array.from({ length: limit }, (_, i) => ({
            id: `t-${page}-${i}`,
            number: page * 1000 + i,
            title: 'filler',
            projectId: 'proj-1',
          })),
          total: 1000,
          page,
          limit,
        };
      }
      return {
        data: [{ id: 'task-42', number: 42, title: 'Fix it', projectId: 'proj-1' }],
        total: 1000,
        page,
        limit,
      };
    });
    const resolver = new AddressResolver(client(get));
    const warnSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const id = await resolver.resolve('CYB-42', taskByProjectAndNumber);

    expect(id).toBe('task-42');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('never caches — a second resolve() re-hits the API rather than reusing the first result', async () => {
    const get = jest.fn(async (path: string) => {
      if (path.startsWith('/projects')) {
        return {
          data: [{ id: 'proj-1', key: 'CYB', name: 'Cybernetics' }],
          total: 1,
          page: 1,
          limit: 100,
        };
      }
      return {
        data: [{ id: 'task-42', number: 42, title: 'Fix it', projectId: 'proj-1' }],
        total: 1,
        page: 1,
        limit: 25,
      };
    });
    const resolver = new AddressResolver(client(get));

    await resolver.resolve('CYB-42', taskByProjectAndNumber);
    const callsAfterFirst = get.mock.calls.length;
    await resolver.resolve('CYB-42', taskByProjectAndNumber);

    expect(get.mock.calls.length).toBe(callsAfterFirst * 2);
  });
});

describe('invoiceByNumber', () => {
  it('resolves an invoice number to its id by paging /invoices and matching exactly', async () => {
    const get = jest.fn(async () => ({
      data: [
        { id: 'inv-1', number: 'INV-2026-0001' },
        { id: 'inv-2', number: 'INV-2026-0002' },
      ],
      total: 2,
      page: 1,
      limit: 100,
    }));
    const resolver = new AddressResolver(client(get));

    await expect(resolver.resolve('INV-2026-0002', invoiceByNumber)).resolves.toBe('inv-2');
  });

  it('passes a well-formed UUID through untouched, without any HTTP call', async () => {
    const get = jest.fn();
    const resolver = new AddressResolver(client(get));

    await expect(resolver.resolve(UUID, invoiceByNumber)).resolves.toBe(UUID);
    expect(get).not.toHaveBeenCalled();
  });

  it('resolves an unissued invoice by its DRAFT-<timestamp> placeholder number', async () => {
    // InvoiceService.create (invoice.service.ts) stamps this format until
    // `issue` allocates the real INV-<year>-<seq> one — invoices ls shows
    // both in its NUMBER column, and line add/bill-time operate on drafts.
    const get = jest.fn(async () => ({
      data: [{ id: 'inv-draft', number: 'DRAFT-1788641675161' }],
      total: 1,
      page: 1,
      limit: 100,
    }));
    const resolver = new AddressResolver(client(get));

    await expect(resolver.resolve('DRAFT-1788641675161', invoiceByNumber)).resolves.toBe('inv-draft');
  });

  it('raises UsageError (exit 2) for a number that matches nothing', async () => {
    const get = jest.fn(async () => ({
      data: [{ id: 'inv-1', number: 'INV-2026-0001' }],
      total: 1,
      page: 1,
      limit: 100,
    }));
    const resolver = new AddressResolver(client(get));

    const err = await rejectionOf(resolver.resolve('INV-2026-9999', invoiceByNumber));

    expect(err).toBeInstanceOf(UsageError);
    expect((err as UsageError).exitCode).toBe(2);
  });

  it('pages past a full first page when the number is on a later one', async () => {
    const get = jest.fn(async (path: string) => {
      const url = new URL(`http://x${path}`);
      const page = Number(url.searchParams.get('page'));
      const limit = Number(url.searchParams.get('limit'));
      if (page === 1) {
        // A full page (length === limit) signals more pages remain.
        return {
          data: Array.from({ length: limit }, (_, i) => ({ id: `filler-${i}`, number: `INV-2025-${i}` })),
          total: limit + 1,
          page,
          limit,
        };
      }
      return { data: [{ id: 'inv-2', number: 'INV-2026-0002' }], total: limit + 1, page, limit };
    });
    const resolver = new AddressResolver(client(get));

    await expect(resolver.resolve('INV-2026-0002', invoiceByNumber)).resolves.toBe('inv-2');
    expect(get).toHaveBeenCalledTimes(2);
  });
});
