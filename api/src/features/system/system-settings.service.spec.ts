import { NotFoundException } from '@nestjs/common';
import { SystemSettingsService } from './system-settings.service';

function makeRow(overrides: Record<string, any> = {}) {
  return {
    id: 'set1',
    key: 'app.display_name',
    valueJson: 'Cybernetics',
    type: 'string',
    category: 'general',
    description: null,
    createdAt: new Date('2020-01-01'),
    updatedAt: new Date('2020-01-01'),
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  };
}

const ctx = { actorId: 'admin-1', ip: '1.2.3.4', userAgent: 'jest' };

describe('SystemSettingsService', () => {
  let repo: any;
  let cache: any;
  let audit: any;
  let service: SystemSettingsService;

  beforeEach(() => {
    repo = {
      findByKey: jest.fn(async () => makeRow()),
      list: jest.fn(async () => ({ rows: [makeRow()], total: 1 })),
      upsertByKey: jest.fn(async (key: string, patch: any) =>
        makeRow({ key, ...patch }),
      ),
      softDelete: jest.fn(async () => undefined),
    };
    cache = {
      get: jest.fn(async () => undefined),
      set: jest.fn(async () => undefined),
      del: jest.fn(async () => true),
    };
    audit = { record: jest.fn(async () => undefined) };
    service = new SystemSettingsService(repo, cache, audit);
  });

  it('reads through cache and populates it on a miss', async () => {
    const res = await service.get('app.display_name');
    expect(cache.get).toHaveBeenCalledWith('system:setting:app.display_name');
    expect(repo.findByKey).toHaveBeenCalledWith('app.display_name');
    expect(cache.set).toHaveBeenCalledWith(
      'system:setting:app.display_name',
      expect.objectContaining({
        key: 'app.display_name',
        value: 'Cybernetics',
      }),
      expect.any(Number),
    );
    expect(res.value).toBe('Cybernetics');
  });

  it('returns the cached value without hitting the repo', async () => {
    cache.get.mockResolvedValueOnce({
      key: 'app.display_name',
      value: 'Cached',
      type: 'string',
      category: 'general',
      description: null,
      updatedAt: new Date(),
    });
    const res = await service.get('app.display_name');
    expect(repo.findByKey).not.toHaveBeenCalled();
    expect(res.value).toBe('Cached');
  });

  it('404s on a missing key', async () => {
    repo.findByKey.mockResolvedValueOnce(null);
    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('upserts, audits, and invalidates the cache', async () => {
    await service.upsert(
      'features.signup_enabled',
      { value: true, type: 'boolean' } as any,
      ctx,
    );
    expect(repo.upsertByKey).toHaveBeenCalledWith(
      'features.signup_enabled',
      expect.objectContaining({ valueJson: true, type: 'boolean' }),
    );
    expect(cache.del).toHaveBeenCalledWith(
      'system:setting:features.signup_enabled',
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'setting.update',
        entityType: 'setting',
      }),
    );
  });

  it('typed getter returns a default when the key is missing', async () => {
    repo.findByKey.mockResolvedValueOnce(null);
    expect(await service.getBoolean('missing', false)).toBe(false);
  });

  it('getNumber returns the stored number', async () => {
    repo.findByKey.mockResolvedValueOnce(
      makeRow({ valueJson: 42, type: 'number' }),
    );
    expect(await service.getNumber('some.count')).toBe(42);
  });
});
