import { Injectable, Logger } from '@nestjs/common';
import { userIdOrNull, type Principal } from '../../common/principal';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type { TaskRow } from '../../infrastructure/database/schema/project.schema';
import { ActivityService } from '../shared/activity.service';
import { EntityCascadeService } from '../shared/entity-cascade.service';
import { TagService } from '../shared/tag.service';
import type {
  AddDependencyDto,
  CreateTaskDto,
  ListTasksDto,
  MoveTaskDto,
  UpdateTaskDto,
} from './dto/task.dto';
import { initialRank, rankBetween } from './lexorank.util';
import { ProjectProjectionService } from './project-projection.service';
import { ProjectRepository } from './project.repository';
import { ProjectService } from './project.service';
import { TaskRepository } from './task.repository';

/** Statuses that mean the work is over. */
const TERMINAL: TaskRow['status'][] = ['done', 'cancelled'];

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly repo: TaskRepository,
    private readonly projects: ProjectService,
    // The task-number counter lives on the project row, so allocating one is a
    // project write even though a task is what needs it.
    private readonly projectRepo: ProjectRepository,
    private readonly projection: ProjectProjectionService,
    private readonly tags: TagService,
    private readonly activity: ActivityService,
    private readonly cascade: EntityCascadeService,
    private readonly errors: ExceptionService,
  ) {}

  private toDateString(d: Date | null | undefined): string | null | undefined {
    if (d === undefined) return undefined;
    return d === null ? null : d.toISOString().slice(0, 10);
  }

  async create(dto: CreateTaskDto, principal: Principal): Promise<TaskRow> {
    // Every task belongs to a project, and the project decides who may add one.
    await this.projects.require(dto.projectId, principal, 'contributor');
    if (dto.tagIds?.length) {
      await this.tags.resolveForScope(dto.tagIds, 'task');
    }

    const { tagIds, ...rest } = dto;
    const number = await this.projectRepo.allocateTaskNumber(dto.projectId);
    const ranks = await this.repo.ranksAround(dto.projectId, dto.status);
    const row = await this.repo.create({
      ...rest,
      number,
      startDate: this.toDateString(dto.startDate),
      dueDate: this.toDateString(dto.dueDate),
      reporterUserId: userIdOrNull(principal),
      // New work lands at the bottom of its column.
      sortRank:
        ranks.length > 0
          ? rankBetween(ranks[ranks.length - 1], null)
          : initialRank(),
    });

    if (tagIds?.length) {
      await this.repo.setTags(row.id, tagIds, userIdOrNull(principal));
    }
    await this.watchImplicitly(row, principal);
    await this.afterWrite(row.id, dto.projectId);
    await this.activity.recordSafe({
      principal,
      entityType: 'task',
      entityId: row.id,
      projectId: row.projectId,
      action: 'task.created',
      summary: row.title,
    });
    return row;
  }

  async list(dto: ListTasksDto, principal: Principal) {
    // A project filter is checked directly; without one, the query is narrowed
    // to the projects the caller can see, so a cross-project board cannot leak.
    if (dto.projectId) {
      await this.projects.require(dto.projectId, principal, 'viewer');
      const { rows, total } = await this.repo.list(dto);
      return { data: rows, total, page: dto.page, limit: dto.limit };
    }
    const projectIds = await this.projects.visibleProjectIds(principal);
    const { rows, total } = await this.repo.list({ ...dto, projectIds });
    return { data: rows, total, page: dto.page, limit: dto.limit };
  }

  async get(id: string, principal: Principal): Promise<TaskRow> {
    const { task } = await this.require(id, principal, 'viewer');
    return task;
  }

  async update(
    id: string,
    dto: UpdateTaskDto,
    principal: Principal,
  ): Promise<TaskRow> {
    const { task } = await this.require(id, principal, 'contributor');
    if (dto.tagIds?.length) {
      await this.tags.resolveForScope(dto.tagIds, 'task');
    }

    const nextStatus = dto.status ?? task.status;
    if (nextStatus === 'blocked') {
      const reason = dto.blockedReason ?? task.blockedReason;
      if (!reason) {
        // A blocked task with no stated blocker is invisible work.
        throw this.errors.validation([
          {
            path: 'blockedReason',
            message: 'A blocked task must say what is blocking it',
          },
        ]);
      }
    }
    if (
      dto.status &&
      !TERMINAL.includes(task.status) &&
      dto.status === 'done'
    ) {
      const blockers = await this.repo.unfinishedPredecessors(id);
      if (blockers.length > 0) {
        throw this.errors.create(ErrorCode.CONFLICT, {
          message:
            `Cannot complete: ${blockers.length} predecessor task(s) are ` +
            `still open`,
        });
      }
    }

    const { tagIds, ...rest } = dto;
    const patch: Record<string, unknown> = {
      ...rest,
      startDate: this.toDateString(dto.startDate),
      dueDate: this.toDateString(dto.dueDate),
    };
    if (dto.status === 'done' && task.status !== 'done') {
      patch.completedAt = new Date();
    }
    if (dto.status && dto.status !== 'blocked') patch.blockedReason = null;

    const updated = await this.repo.update(id, patch);
    if (!updated) throw this.errors.create(ErrorCode.NOT_FOUND);
    if (tagIds) await this.repo.setTags(id, tagIds, userIdOrNull(principal));

    // Assignment implies watching: the notification layer reads watchers, and
    // an assignee who is not one would never hear about their own task.
    if (dto.assigneeUserId) {
      await this.repo.watch(id, dto.assigneeUserId, 'assigned');
    }
    await this.afterWrite(id, task.projectId);
    await this.activity.recordSafe({
      principal,
      entityType: 'task',
      entityId: id,
      projectId: task.projectId,
      action: dto.status ? 'task.status_changed' : 'task.updated',
      changes: dto.status
        ? { status: { from: task.status, to: dto.status } }
        : undefined,
    });
    return updated;
  }

  /**
   * Move a task within or between board columns.
   *
   * Writes exactly one row: the new rank is computed between its neighbours,
   * which is the entire reason ranks are strings rather than integers.
   */
  async move(
    id: string,
    dto: MoveTaskDto,
    principal: Principal,
  ): Promise<TaskRow> {
    const { task } = await this.require(id, principal, 'contributor');
    const status = dto.status ?? task.status;
    const ranks = (await this.repo.ranksAround(task.projectId, status)).filter(
      (r) => r !== task.sortRank,
    );

    let sortRank: string;
    if (!dto.afterTaskId) {
      sortRank = ranks.length > 0 ? rankBetween(null, ranks[0]) : initialRank();
    } else {
      const anchor = await this.repo.findLiveById(dto.afterTaskId);
      if (!anchor || anchor.projectId !== task.projectId || !anchor.sortRank) {
        throw this.errors.validation([
          { path: 'afterTaskId', message: 'Anchor task is not on this board' },
        ]);
      }
      const following = ranks.find((r) => r > anchor.sortRank!) ?? null;
      sortRank = rankBetween(anchor.sortRank, following);
    }

    const updated = await this.repo.update(id, { status, sortRank });
    if (!updated) throw this.errors.create(ErrorCode.NOT_FOUND);
    await this.afterWrite(id, task.projectId);
    return updated;
  }

  async remove(id: string, principal: Principal): Promise<void> {
    const { task } = await this.require(id, principal, 'contributor');
    await this.repo.softDelete(id);
    await this.cascade.purgeFor('task', id);
    await this.projection.removeTask(id);
    await this.projects.require(task.projectId, principal, 'viewer');
    await this.activity.recordSafe({
      principal,
      entityType: 'task',
      entityId: id,
      projectId: task.projectId,
      action: 'task.deleted',
    });
  }

  // --- dependencies ---

  async dependencies(id: string, principal: Principal) {
    await this.require(id, principal, 'viewer');
    return this.repo.dependencies(id);
  }

  /**
   * Add a predecessor, refusing to create a cycle.
   *
   * The database check only catches a self-edge; a longer loop
   * (A -> B -> C -> A) needs a walk, done here before the insert. The graph is
   * project-local and small, so a breadth-first walk is cheap.
   */
  async addDependency(id: string, dto: AddDependencyDto, principal: Principal) {
    const { task } = await this.require(id, principal, 'contributor');
    if (dto.predecessorTaskId === id) {
      throw this.errors.validation([
        {
          path: 'predecessorTaskId',
          message: 'A task cannot depend on itself',
        },
      ]);
    }
    const predecessor = await this.repo.findLiveById(dto.predecessorTaskId);
    if (!predecessor || predecessor.projectId !== task.projectId) {
      throw this.errors.validation([
        {
          path: 'predecessorTaskId',
          message: 'Dependencies must stay within one project',
        },
      ]);
    }
    // The edge being added is `predecessor -> id`. It closes a loop precisely
    // when the predecessor ALREADY depends on `id`, so the walk has to start at
    // the predecessor and look for `id`. Starting at `id` instead asks whether
    // the edge is redundant, which is a different question with the same shape
    // — and answers "no" for every real cycle, letting A->B->A straight through.
    if (await this.reaches(dto.predecessorTaskId, id)) {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: 'That dependency would create a cycle',
      });
    }
    return this.repo.addDependency(
      dto.predecessorTaskId,
      id,
      dto.type,
      dto.lagDays,
    );
  }

  async removeDependency(
    id: string,
    dependencyId: string,
    principal: Principal,
  ): Promise<void> {
    await this.require(id, principal, 'contributor');
    const removed = await this.repo.removeDependency(dependencyId);
    if (!removed) throw this.errors.create(ErrorCode.NOT_FOUND);
  }

  /** Whether `from` already reaches `target` through predecessor edges. */
  private async reaches(from: string, target: string): Promise<boolean> {
    const seen = new Set<string>();
    const queue = [from];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === target && current !== from) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      const predecessors = await this.repo.predecessorsOf(current);
      for (const p of predecessors) {
        if (p === target) return true;
        queue.push(p);
      }
    }
    return false;
  }

  // --- watchers ---

  async watchers(id: string, principal: Principal) {
    await this.require(id, principal, 'viewer');
    return this.repo.watchers(id);
  }

  async watch(id: string, principal: Principal): Promise<void> {
    await this.require(id, principal, 'viewer');
    await this.repo.watch(id, this.projects.requireUser(principal), 'manual');
  }

  async unwatch(id: string, principal: Principal): Promise<void> {
    await this.require(id, principal, 'viewer');
    await this.repo.unwatch(id, this.projects.requireUser(principal));
  }

  /** Load a task and check the caller's role on its project. */
  async require(
    id: string,
    principal: Principal,
    needed: 'viewer' | 'contributor' | 'manager' | 'owner',
  ): Promise<{ task: TaskRow }> {
    const task = await this.repo.findLiveById(id);
    if (!task) throw this.errors.create(ErrorCode.NOT_FOUND);
    await this.projects.require(task.projectId, principal, needed);
    return { task };
  }

  /** Whether a principal may read a task — the registry's resolver. */
  async canRead(id: string, principal: Principal): Promise<boolean> {
    const task = await this.repo.findLiveById(id);
    if (!task) return false;
    return this.projects.canRead(task.projectId, principal);
  }

  /** Everyone implicated in a task's creation starts watching it. */
  private async watchImplicitly(
    task: TaskRow,
    principal: Principal,
  ): Promise<void> {
    const reporter = userIdOrNull(principal);
    if (reporter) await this.repo.watch(task.id, reporter, 'reporter');
    if (task.assigneeUserId) {
      await this.repo.watch(task.id, task.assigneeUserId, 'assigned');
    }
  }

  /** Denormalizations and the index, kept in step after every task write. */
  private async afterWrite(taskId: string, projectId: string): Promise<void> {
    await this.projects.repoRefreshProgress(projectId);
    await this.projection.projectTask(taskId);
  }
}
