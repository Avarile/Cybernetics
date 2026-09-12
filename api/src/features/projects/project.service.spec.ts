import { ExceptionService } from '../../infrastructure/exceptions';
import { SYSTEM_PRINCIPAL, type Principal } from '../../common/principal';
import { ProjectService } from './project.service';

const user: Principal = { kind: 'user', userId: 'u1', role: 'user' };
const admin: Principal = { kind: 'user', userId: 'a1', role: 'admin' };

function project(id: string, over: Partial<any> = {}) {
  return {
    id,
    name: `Project ${id}`,
    ownerUserId: null,
    visibility: 'internal',
    status: 'active',
    isDeleted: false,
    ...over,
  };
}

const page = { page: 1, limit: 100 } as any;

describe('ProjectService.list', () => {
  let repo: any;
  let svc: ProjectService;
  const rows = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => project(id));

  beforeEach(() => {
    repo = {
      list: jest.fn(async () => ({ rows, total: rows.length })),
      membership: jest.fn(async () => null),
      membershipsForMany: jest.fn(async () => new Map()),
    };
    svc = new ProjectService(
      repo,
      {} as any, // projection
      {} as any, // tags
      {} as any, // activity
      {} as any, // cascade
      new ExceptionService(),
    );
  });

  it('resolves a whole page of memberships in ONE query', async () => {
    // The regression: access was resolved per row, and `accessFor` issued one
    // `membership` select per project. A 100-row page therefore fired 100
    // concurrent queries at a pool of 20 shared with the queue workers.
    await svc.list(page, user);
    expect(repo.membershipsForMany).toHaveBeenCalledTimes(1);
    expect(repo.membershipsForMany).toHaveBeenCalledWith(
      ['p1', 'p2', 'p3', 'p4', 'p5'],
      'u1',
    );
    expect(repo.membership).not.toHaveBeenCalled();
  });

  it('still grants the access a membership confers', async () => {
    repo.membershipsForMany.mockResolvedValueOnce(
      new Map([['p2', { projectId: 'p2', roleInProject: 'manager' }]]),
    );
    const out = await svc.list(page, user);
    const byId = Object.fromEntries(out.data.map((p: any) => [p.id, p.access]));
    expect(byId.p2).toBe('manager');
  });

  it('does not query memberships for an admin', async () => {
    // `accessFor` short-circuits admins, which is exactly why the N+1 never
    // showed up in admin-authenticated testing.
    const out = await svc.list(page, admin);
    expect(repo.membershipsForMany).not.toHaveBeenCalled();
    expect(out.data.every((p: any) => p.access === 'owner')).toBe(true);
  });

  it('does not query memberships for the system principal', async () => {
    const out = await svc.list(page, SYSTEM_PRINCIPAL);
    expect(repo.membershipsForMany).not.toHaveBeenCalled();
    expect(out.data.every((p: any) => p.access === 'owner')).toBe(true);
  });

  it('reports the repository total, not the page length', async () => {
    repo.list.mockResolvedValueOnce({ rows, total: 412 });
    const out = await svc.list(page, user);
    expect(out.total).toBe(412);
  });
});
