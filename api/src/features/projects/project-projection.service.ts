import { Injectable, Logger } from '@nestjs/common';
import type { FieldSpec } from '../../infrastructure/database/schema/search.schema';
import { SearchRecordService } from '../search-service/search-record.service';
import { ProjectRepository } from './project.repository';
import { TaskRepository } from './task.repository';

export const PROJECTS_COLLECTION = 'projects';
export const TASKS_COLLECTION = 'tasks';

/** Field specs. `memberUserIds` is the ACL array both collections scope on. */
export function projectsCollectionFields(): FieldSpec[] {
  return [
    { name: 'key', type: 'string', searchable: true, filterable: true },
    { name: 'name', type: 'string', searchable: true },
    { name: 'description', type: 'string', searchable: true },
    { name: 'status', type: 'string', filterable: true },
    { name: 'priority', type: 'string', filterable: true },
    { name: 'ownerUserId', type: 'string', filterable: true },
    { name: 'memberUserIds', type: 'string[]', filterable: true },
    { name: 'tagIds', type: 'string[]', filterable: true },
    { name: 'updatedAt', type: 'string', sortable: true },
  ];
}

export function tasksCollectionFields(): FieldSpec[] {
  return [
    { name: 'number', type: 'number', filterable: true, sortable: true },
    { name: 'reference', type: 'string', searchable: true, filterable: true },
    { name: 'title', type: 'string', searchable: true },
    { name: 'description', type: 'string', searchable: true },
    { name: 'status', type: 'string', filterable: true },
    { name: 'priority', type: 'string', filterable: true },
    { name: 'projectId', type: 'string', filterable: true },
    { name: 'projectKey', type: 'string', filterable: true },
    { name: 'assigneeUserId', type: 'string', filterable: true },
    { name: 'memberUserIds', type: 'string[]', filterable: true },
    { name: 'dueDate', type: 'string', filterable: true, sortable: true },
  ];
}

/** Body text stored per task; full descriptions bloat every hit and reindex. */
const INDEXED_DESCRIPTION_CHARS = 10_000;

/**
 * Projects projects and tasks into the search index.
 *
 * Both scope on the project's member set, because a task's readability is its
 * project's. That makes membership changes a fan-out: adding one member
 * reprojects the project AND every task in it, which is why
 * {@link reprojectProjectAndTasks} exists and why callers must not inline it —
 * a thousand-task project would otherwise block the request that added a member.
 */
@Injectable()
export class ProjectProjectionService {
  private readonly logger = new Logger(ProjectProjectionService.name);

  constructor(
    private readonly records: SearchRecordService,
    private readonly projects: ProjectRepository,
    private readonly tasks: TaskRepository,
  ) {}

  async projectProject(projectId: string): Promise<void> {
    const row = await this.projects.findLiveById(projectId);
    if (!row) {
      await this.records.remove(PROJECTS_COLLECTION, projectId);
      return;
    }
    const scope = await this.scopeFor(projectId, row.ownerUserId);
    if (scope.length === 0) {
      // Unreadable by anyone but an admin, and `persist` refuses an empty
      // scope. Drop it rather than fail the caller's write.
      await this.records.remove(PROJECTS_COLLECTION, projectId);
      return;
    }
    const tagIds = await this.projects.tagIdsFor(projectId);
    await this.records.persist(PROJECTS_COLLECTION, [
      {
        externalId: projectId,
        document: {
          key: row.key,
          name: row.name,
          description: (row.description ?? '').slice(
            0,
            INDEXED_DESCRIPTION_CHARS,
          ),
          status: row.status,
          priority: row.priority,
          ownerUserId: row.ownerUserId ?? '',
          memberUserIds: scope,
          tagIds,
          updatedAt: row.updatedAt.toISOString(),
        },
      },
    ]);
  }

  async projectTask(taskId: string): Promise<void> {
    const task = await this.tasks.findLiveById(taskId);
    if (!task) {
      await this.records.remove(TASKS_COLLECTION, taskId);
      return;
    }
    const project = await this.projects.findLiveById(task.projectId);
    if (!project) {
      await this.records.remove(TASKS_COLLECTION, taskId);
      return;
    }
    const scope = await this.scopeFor(project.id, project.ownerUserId);
    if (scope.length === 0) {
      await this.records.remove(TASKS_COLLECTION, taskId);
      return;
    }
    await this.records.persist(TASKS_COLLECTION, [
      {
        externalId: taskId,
        document: {
          number: task.number,
          reference: `${project.key}-${task.number}`,
          title: task.title,
          description: (task.description ?? '').slice(
            0,
            INDEXED_DESCRIPTION_CHARS,
          ),
          status: task.status,
          priority: task.priority,
          projectId: project.id,
          projectKey: project.key,
          assigneeUserId: task.assigneeUserId ?? '',
          memberUserIds: scope,
          dueDate: task.dueDate ?? '',
        },
      },
    ]);
  }

  async removeTask(taskId: string): Promise<void> {
    await this.records.remove(TASKS_COLLECTION, taskId);
  }

  async removeProject(projectId: string): Promise<void> {
    await this.records.remove(PROJECTS_COLLECTION, projectId);
  }

  /**
   * Reproject a project and every task in it.
   *
   * Called after a membership change, which invalidates the scope array on all
   * of them. Bounded by page so one enormous project cannot hold the event loop;
   * the reconciliation sweep repairs anything a failure leaves behind.
   */
  async reprojectProjectAndTasks(projectId: string): Promise<void> {
    await this.projectProject(projectId);
    let page = 1;
    for (;;) {
      const { rows } = await this.tasks.list({ projectId, page, limit: 200 });
      if (rows.length === 0) break;
      for (const task of rows) {
        await this.projectTask(task.id);
      }
      if (rows.length < 200) break;
      page += 1;
    }
  }

  /** Owner plus members — everyone who may read anything under the project. */
  private async scopeFor(
    projectId: string,
    ownerUserId: string | null,
  ): Promise<string[]> {
    const ids = new Set(await this.projects.memberUserIds(projectId));
    if (ownerUserId) ids.add(ownerUserId);
    return [...ids];
  }
}
