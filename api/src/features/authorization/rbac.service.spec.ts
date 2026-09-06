import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type { Principal } from '../../common/principal';
import { RbacService } from './rbac.service';

const admin: Principal = { kind: 'user', userId: 'a1', role: 'admin' };

describe('RbacService — per-user permission overrides', () => {
  let repo: any;
  let cache: any;
  let activity: any;
  let rbac: RbacService;

  beforeEach(() => {
    repo = {
      userExists: jest.fn(async () => true),
      findPermissionByKey: jest.fn(async () => ({
        id: 'p1',
        key: 'finance.read',
      })),
      grantPermission: jest.fn(async () => undefined),
      revokePermission: jest.fn(async () => true),
      overridesDetailForUser: jest.fn(async () => []),
      permissionKeysForUser: jest.fn(async () => ['project.read']),
      overridesForUser: jest.fn(async () => []),
    };
    cache = { invalidateAll: jest.fn(async () => undefined) };
    activity = { recordSafe: jest.fn(async () => undefined) };
    rbac = new RbacService(repo, cache, activity, new ExceptionService());
  });

  it('grants an override and invalidates the permission cache', async () => {
    // The invalidation is the correctness story: an override that is not
    // invalidated keeps NOT applying for the cache TTL after it was granted.
    await rbac.grantPermission(
      'u1',
      {
        permissionKey: 'finance.read',
        effect: 'allow',
        reason: 'Covering for the finance lead',
      } as any,
      admin,
    );
    expect(repo.grantPermission).toHaveBeenCalledWith(
      'u1',
      'p1',
      'allow',
      'Covering for the finance lead',
      'a1',
      null,
    );
    expect(cache.invalidateAll).toHaveBeenCalled();
  });

  it('records the reason in the activity log', async () => {
    // An exception without a recorded reason becomes permanent by amnesia.
    await rbac.grantPermission(
      'u1',
      {
        permissionKey: 'finance.read',
        effect: 'deny',
        reason: 'Under investigation',
      } as any,
      admin,
    );
    const entry = activity.recordSafe.mock.calls[0][0];
    expect(entry.action).toBe('rbac.permission_granted');
    expect(entry.summary).toContain('Under investigation');
  });

  it('refuses an override naming a permission outside the catalog', async () => {
    // Otherwise a typo becomes a row nobody ever resolves.
    repo.findPermissionByKey.mockResolvedValueOnce(null);
    await expect(
      rbac.grantPermission(
        'u1',
        {
          permissionKey: 'finance.raed',
          effect: 'allow',
          reason: 'typo',
        } as any,
        admin,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    expect(cache.invalidateAll).not.toHaveBeenCalled();
  });

  it('refuses an override for a user that does not exist', async () => {
    repo.userExists.mockResolvedValueOnce(false);
    await expect(
      rbac.grantPermission(
        'ghost',
        { permissionKey: 'finance.read', effect: 'allow', reason: 'x' } as any,
        admin,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.USER_NOT_FOUND });
  });

  it('reports revoking an override the user does not hold', async () => {
    // A silent success here would read as "the deny is gone" when it never was.
    repo.revokePermission.mockResolvedValueOnce(false);
    await expect(
      rbac.revokePermission('u1', 'finance.read', admin),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('invalidates the cache when an override is revoked', async () => {
    await rbac.revokePermission('u1', 'finance.read', admin);
    expect(cache.invalidateAll).toHaveBeenCalled();
    expect(activity.recordSafe).toHaveBeenCalled();
  });

  it('deny wins over a role grant in the effective set', async () => {
    repo.permissionKeysForUser.mockResolvedValueOnce([
      'finance.read',
      'project.read',
    ]);
    repo.overridesForUser.mockResolvedValueOnce([
      { key: 'finance.read', effect: 'deny' },
    ]);
    await expect(rbac.effectiveFor('u1')).resolves.toEqual(['project.read']);
  });
});
