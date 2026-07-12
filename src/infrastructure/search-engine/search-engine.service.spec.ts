import type { ConfigService } from '@nestjs/config';
import { SearchEngineService } from './search-engine.service';
import { SearchEngineError } from './search-engine.interface';

/* eslint-disable @typescript-eslint/no-unsafe-argument */

function makeClient() {
  const index = {
    updateSettings: jest.fn(async () => ({ taskUid: 2 })),
    addDocuments: jest.fn(async () => ({ taskUid: 3 })),
    updateDocuments: jest.fn(async () => ({ taskUid: 4 })),
    deleteDocuments: jest.fn(async () => ({ taskUid: 5 })),
    deleteAllDocuments: jest.fn(async () => ({ taskUid: 6 })),
    search: jest.fn(async () => ({
      hits: [{ id: 'a' }],
      totalHits: 1,
      totalPages: 1,
      hitsPerPage: 20,
      page: 1,
      processingTimeMs: 3,
    })),
  };
  return {
    index: jest.fn(() => index),
    createIndex: jest.fn(async () => ({ taskUid: 1 })),
    isHealthy: jest.fn(async () => true),
    tasks: {
      waitForTask: jest.fn(async () => ({
        status: 'succeeded',
        error: undefined,
      })),
    },
    __index: index,
  };
}

const config = {
  getOrThrow: () => ({ indexPrefix: 'test_', taskTimeoutMs: 1000 }),
} as unknown as ConfigService;

describe('SearchEngineService', () => {
  let client: ReturnType<typeof makeClient>;
  let service: SearchEngineService;

  beforeEach(() => {
    client = makeClient();
    service = new SearchEngineService(client as any, config);
  });

  it('ensureIndex applies the prefix, creates, and updates settings', async () => {
    await service.ensureIndex({
      name: 'docs',
      primaryKey: 'id',
      searchableAttributes: ['title'],
      filterableAttributes: ['ownerId'],
      sortableAttributes: ['createdAt'],
    });
    expect(client.createIndex).toHaveBeenCalledWith('test_docs', {
      primaryKey: 'id',
    });
    expect(client.index).toHaveBeenCalledWith('test_docs');
    expect(client.__index.updateSettings).toHaveBeenCalled();
  });

  it('ensureIndex tolerates an already-existing index', async () => {
    client.createIndex.mockRejectedValueOnce({ code: 'index_already_exists' });
    await expect(
      service.ensureIndex({
        name: 'docs',
        primaryKey: 'id',
        searchableAttributes: [],
        filterableAttributes: [],
        sortableAttributes: [],
      }),
    ).resolves.toBeUndefined();
    expect(client.__index.updateSettings).toHaveBeenCalled();
  });

  it('search maps the response into EngineResult', async () => {
    const res = await service.search('docs', {
      q: 'hi',
      page: 1,
      hitsPerPage: 20,
    });
    expect(res.hits).toEqual([{ id: 'a' }]);
    expect(res.totalHits).toBe(1);
    expect(res.totalPages).toBe(1);
  });

  it('waitForTask throws SearchEngineError when a task fails', async () => {
    client.tasks.waitForTask.mockResolvedValueOnce({
      status: 'failed',
      error: { message: 'boom', code: 'bad' },
    });
    await expect(service.waitForTask(9)).rejects.toBeInstanceOf(
      SearchEngineError,
    );
  });

  it('health returns false when the client throws', async () => {
    client.isHealthy.mockRejectedValueOnce(new Error('down'));
    expect(await service.health()).toBe(false);
  });
});
