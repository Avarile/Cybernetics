import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  getTableColumns,
  eq,
  ilike,
  inArray,
  lte,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import { BaseRepository } from '../../infrastructure/database/repositories/base.repository';
import {
  taskDependencies,
  taskTags,
  taskWatchers,
  tasks,
  type NewTaskRow,
  type TaskDependencyRow,
  type TaskRow,
  type TaskWatcherRow,
} from '../../infrastructure/database/schema/project.schema';

export interface TaskQuery {
  projectId?: string;
  status?: TaskRow['status'];
  assigneeUserId?: string;
  milestoneId?: string;
  search?: string;
  /** Restrict to projects the caller can see; empty means "none". */
  projectIds?: string[];
  page: number;
  limit: number;
}

@Injectable()
export class TaskRepository extends BaseRepository<typeof tasks> {
  constructor(@Inject(DRIZZLE) db: DrizzleDB) {
    super(db, tasks);
  }

  async findLiveById(id: string): Promise<TaskRow | null> {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(q: TaskQuery): Promise<{ rows: TaskRow[]; total: number }> {
    const filters: SQL[] = [eq(tasks.isDeleted, false)];
    if (q.projectId) filters.push(eq(tasks.projectId, q.projectId));
    if (q.status) filters.push(eq(tasks.status, q.status));
    if (q.assigneeUserId)
      filters.push(eq(tasks.assigneeUserId, q.assigneeUserId));
    if (q.milestoneId) filters.push(eq(tasks.milestoneId, q.milestoneId));
    if (q.search) filters.push(ilike(tasks.title, `%${q.search}%`));
    if (q.projectIds) {
      // An empty visible set must return nothing — `inArray` with an empty list
      // is a false predicate, which is exactly right here.
      filters.push(
        q.projectIds.length > 0
          ? inArray(tasks.projectId, q.projectIds)
          : sql`false`,
      );
    }
    const where = and(...filters);
    const rows = await this.db
      .select()
      .from(tasks)
      .where(where)
      // Board order: the rank is what drag-and-drop writes, and NULLs (never
      // ranked) sort last so an unranked task does not jump to the top.
      .orderBy(asc(tasks.sortRank), asc(tasks.number))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    const totals = await this.db
      .select({ value: count() })
      .from(tasks)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  /** Neighbouring ranks in a board column, for computing a rank between them. */
  async ranksAround(
    projectId: string,
    status: TaskRow['status'],
  ): Promise<string[]> {
    const rows = await this.db
      .select({ rank: tasks.sortRank })
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, projectId),
          eq(tasks.status, status),
          eq(tasks.isDeleted, false),
        ),
      )
      .orderBy(asc(tasks.sortRank));
    return rows.map((r) => r.rank).filter((r): r is string => r !== null);
  }

  async create(values: NewTaskRow): Promise<TaskRow> {
    const rows = await this.db.insert(tasks).values(values).returning();
    return rows[0];
  }

  async update(
    id: string,
    patch: Partial<NewTaskRow>,
  ): Promise<TaskRow | null> {
    const rows = await this.db
      .update(tasks)
      .set(patch)
      .where(and(eq(tasks.id, id), eq(tasks.isDeleted, false)))
      .returning();
    return rows[0] ?? null;
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(tasks)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(tasks.id, id));
  }

  /** Recompute logged minutes from the time entries that back them. */
  async refreshSpentMinutes(taskId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE ${tasks} SET spent_minutes = COALESCE((
        SELECT SUM(minutes) FROM time_entries
        WHERE task_id = ${taskId} AND is_deleted = false
      ), 0) WHERE id = ${taskId}
    `);
  }

  /** Open tasks past their due date — the reminder sweep's query. */
  async overdue(now: Date, limit: number): Promise<TaskRow[]> {
    return this.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.isDeleted, false),
          notInArray(tasks.status, ['done', 'cancelled']),
          lte(tasks.dueDate, now.toISOString().slice(0, 10)),
        ),
      )
      .limit(limit);
  }

  // --- dependencies ---

  async dependencies(taskId: string): Promise<TaskDependencyRow[]> {
    return this.db
      .select()
      .from(taskDependencies)
      .where(
        and(
          or(
            eq(taskDependencies.predecessorTaskId, taskId),
            eq(taskDependencies.successorTaskId, taskId),
          )!,
          eq(taskDependencies.isDeleted, false),
        ),
      );
  }

  /** Direct predecessors of a task — one step of the cycle walk. */
  async predecessorsOf(taskId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: taskDependencies.predecessorTaskId })
      .from(taskDependencies)
      .where(
        and(
          eq(taskDependencies.successorTaskId, taskId),
          eq(taskDependencies.isDeleted, false),
        ),
      );
    return rows.map((r) => r.id);
  }

  async addDependency(
    predecessorTaskId: string,
    successorTaskId: string,
    type: TaskDependencyRow['type'],
    lagDays: number,
  ): Promise<TaskDependencyRow> {
    const rows = await this.db
      .insert(taskDependencies)
      .values({ predecessorTaskId, successorTaskId, type, lagDays })
      .returning();
    return rows[0];
  }

  async removeDependency(id: string): Promise<boolean> {
    const rows = await this.db
      .update(taskDependencies)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(
        and(eq(taskDependencies.id, id), eq(taskDependencies.isDeleted, false)),
      )
      .returning({ id: taskDependencies.id });
    return rows.length > 0;
  }

  /** Incomplete predecessors — what blocks a task from starting. */
  async unfinishedPredecessors(taskId: string): Promise<TaskRow[]> {
    return this.db
      .select(getTableColumns(tasks))
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.predecessorTaskId))
      .where(
        and(
          eq(taskDependencies.successorTaskId, taskId),
          eq(taskDependencies.isDeleted, false),
          eq(tasks.isDeleted, false),
          notInArray(tasks.status, ['done', 'cancelled']),
        ),
      );
  }

  // --- watchers ---

  async watchers(taskId: string): Promise<TaskWatcherRow[]> {
    return this.db
      .select()
      .from(taskWatchers)
      .where(
        and(eq(taskWatchers.taskId, taskId), eq(taskWatchers.isDeleted, false)),
      );
  }

  /**
   * Add a watcher, ignoring a repeat.
   *
   * Called implicitly whenever someone is assigned, comments or is mentioned,
   * so it must be safe to call for someone already watching.
   */
  async watch(
    taskId: string,
    userId: string,
    reason: TaskWatcherRow['reason'],
  ): Promise<void> {
    const existing = await this.db
      .select({ id: taskWatchers.id })
      .from(taskWatchers)
      .where(
        and(
          eq(taskWatchers.taskId, taskId),
          eq(taskWatchers.userId, userId),
          eq(taskWatchers.isDeleted, false),
        ),
      )
      .limit(1);
    if (existing[0]) return;
    await this.db.insert(taskWatchers).values({ taskId, userId, reason });
  }

  async unwatch(taskId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .update(taskWatchers)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(
        and(
          eq(taskWatchers.taskId, taskId),
          eq(taskWatchers.userId, userId),
          eq(taskWatchers.isDeleted, false),
        ),
      )
      .returning({ id: taskWatchers.id });
    return rows.length > 0;
  }

  // --- tags ---

  async tagIdsFor(taskId: string): Promise<string[]> {
    const rows = await this.db
      .select({ tagId: taskTags.tagId })
      .from(taskTags)
      .where(and(eq(taskTags.taskId, taskId), eq(taskTags.isDeleted, false)));
    return rows.map((r) => r.tagId);
  }

  async setTags(
    taskId: string,
    tagIds: string[],
    taggedBy: string | null,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(taskTags)
        .set({ isDeleted: true, deletedAt: new Date() })
        .where(
          and(
            eq(taskTags.taskId, taskId),
            eq(taskTags.isDeleted, false),
            tagIds.length > 0 ? notInArray(taskTags.tagId, tagIds) : sql`true`,
          ),
        );
      if (tagIds.length === 0) return;
      const existing = await tx
        .select({ tagId: taskTags.tagId })
        .from(taskTags)
        .where(
          and(
            eq(taskTags.taskId, taskId),
            eq(taskTags.isDeleted, false),
            inArray(taskTags.tagId, tagIds),
          ),
        );
      const held = new Set(existing.map((e) => e.tagId));
      const missing = tagIds.filter((id) => !held.has(id));
      if (missing.length > 0) {
        await tx
          .insert(taskTags)
          .values(missing.map((tagId) => ({ taskId, tagId, taggedBy })));
      }
    });
  }
}
