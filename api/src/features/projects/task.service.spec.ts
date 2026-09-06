import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { TaskService } from './task.service';

/**
 * The dependency graph guard.
 *
 * `addDependency(id, { predecessorTaskId })` creates the edge
 * `predecessor -> id`, and `predecessorsOf(t)` returns the tasks that must
 * finish before `t`. So the edge closes a loop exactly when the PREDECESSOR
 * already depends on `id`, and the reachability walk has to start there.
 *
 * The guard previously walked from `id` instead, which asks whether the edge is
 * redundant. That answers "no" for every genuine cycle, so `A -> B` followed by
 * `B -> A` was accepted and the graph stopped being acyclic — with nothing to
 * stop a scheduler walking it forever.
 */
describe('TaskService dependency cycles', () => {
  /** `edges[successor] = predecessors` — the shape `predecessorsOf` returns. */
  function serviceWith(edges: Record<string, string[]>) {
    const repo = {
      findLiveById: jest.fn(async (id: string) => ({
        id,
        projectId: 'p1',
        status: 'todo',
      })),
      predecessorsOf: jest.fn(async (id: string) => edges[id] ?? []),
      addDependency: jest.fn(async () => ({ id: 'dep1' })),
    };
    const projects = { require: jest.fn(async () => undefined) };
    const service = new TaskService(
      repo as never,
      projects as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new ExceptionService(),
    );
    return { service, repo };
  }

  const principal = { kind: 'user', userId: 'u1', role: 'admin' } as never;
  const dep = (predecessorTaskId: string) => ({ predecessorTaskId }) as never;

  it('accepts an edge that does not close a loop', async () => {
    const { service, repo } = serviceWith({});
    await expect(
      service.addDependency('B', dep('A'), principal),
    ).resolves.toEqual({ id: 'dep1' });
    expect(repo.addDependency).toHaveBeenCalledWith(
      'A',
      'B',
      undefined,
      undefined,
    );
  });

  it('refuses a task depending on itself', async () => {
    const { service } = serviceWith({});
    await expect(
      service.addDependency('A', dep('A'), principal),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });

  // The regression: A -> B exists, so adding B -> A closes a two-node loop.
  it('refuses the reverse of an existing edge', async () => {
    const { service, repo } = serviceWith({ B: ['A'] });
    await expect(
      service.addDependency('A', dep('B'), principal),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    expect(repo.addDependency).not.toHaveBeenCalled();
  });

  // The case the guard's own comment claims to cover.
  it('refuses an edge closing a longer loop', async () => {
    // A -> B -> C already exists; C -> A would close it.
    const { service, repo } = serviceWith({ B: ['A'], C: ['B'] });
    await expect(
      service.addDependency('A', dep('C'), principal),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    expect(repo.addDependency).not.toHaveBeenCalled();
  });

  // A diamond is not a cycle: both branches converge forwards.
  it('accepts a diamond', async () => {
    // A -> B, A -> C already exist; adding B -> D and C -> D is legitimate.
    const { service, repo } = serviceWith({ B: ['A'], C: ['A'], D: ['C'] });
    await expect(
      service.addDependency('D', dep('B'), principal),
    ).resolves.toEqual({ id: 'dep1' });
    expect(repo.addDependency).toHaveBeenCalled();
  });

  it('refuses a dependency that crosses projects', async () => {
    const { service, repo } = serviceWith({});
    repo.findLiveById.mockImplementation(async (id: string) => ({
      id,
      projectId: id === 'X' ? 'p2' : 'p1',
      status: 'todo',
    }));
    await expect(
      service.addDependency('A', dep('X'), principal),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });

  it('terminates on a graph that is already cyclic', async () => {
    // Should never happen, but the walk must not spin if it does.
    const { service } = serviceWith({ A: ['B'], B: ['A'] });
    await expect(
      service.addDependency('C', dep('A'), principal),
    ).resolves.toEqual({ id: 'dep1' });
  });
});
