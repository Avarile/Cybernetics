import { Injectable, Logger } from '@nestjs/common';
import {
  isAdmin,
  requireUserId,
  userIdOrNull,
  type Principal,
} from '../../common/principal';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import type {
  ProjectMemberRow,
  ProjectRow,
} from '../../infrastructure/database/schema/project.schema';
import { ActivityService } from '../shared/activity.service';
import { EntityCascadeService } from '../shared/entity-cascade.service';
import { TagService } from '../shared/tag.service';
import type {
  AddMemberDto,
  CreateProjectDto,
  ListProjectsDto,
  UpdateProjectDto,
} from './dto/project.dto';
import { ProjectProjectionService } from './project-projection.service';
import {
  permitsProject,
  resolveProjectAccess,
  type ProjectAccess,
  type ProjectRole,
} from './project-scope.resolver';
import { ProjectRepository } from './project.repository';

export interface PublicProject {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: ProjectRow['status'];
  priority: ProjectRow['priority'];
  visibility: ProjectRow['visibility'];
  ownerUserId: string | null;
  leadUserId: string | null;
  startDate: string | null;
  dueDate: string | null;
  progressPct: number;
  tagIds: string[];
  /** What the asking principal may do, so a client need not guess. */
  access: ProjectAccess;
  updatedAt: Date;
}

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  constructor(
    private readonly repo: ProjectRepository,
    private readonly projection: ProjectProjectionService,
    private readonly tags: TagService,
    private readonly activity: ActivityService,
    private readonly cascade: EntityCascadeService,
    private readonly errors: ExceptionService,
  ) {}

  private toPublic(
    row: ProjectRow,
    access: ProjectAccess,
    tagIds: string[] = [],
  ): PublicProject {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description ?? null,
      status: row.status,
      priority: row.priority,
      visibility: row.visibility,
      ownerUserId: row.ownerUserId ?? null,
      leadUserId: row.leadUserId ?? null,
      startDate: row.startDate ?? null,
      dueDate: row.dueDate ?? null,
      progressPct: row.progressPct,
      tagIds,
      access,
      updatedAt: row.updatedAt,
    };
  }

  private toDateString(d: Date | null | undefined): string | null | undefined {
    if (d === undefined) return undefined;
    return d === null ? null : d.toISOString().slice(0, 10);
  }

  async create(
    dto: CreateProjectDto,
    principal: Principal,
  ): Promise<PublicProject> {
    if (await this.repo.findByKey(dto.key)) {
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: `Project key "${dto.key}" is already in use`,
      });
    }
    if (dto.tagIds?.length) {
      await this.tags.resolveForScope(dto.tagIds, 'project');
    }
    const { tagIds, ...rest } = dto;
    const ownerUserId = userIdOrNull(principal);
    const row = await this.repo.create({
      ...rest,
      startDate: this.toDateString(dto.startDate),
      dueDate: this.toDateString(dto.dueDate),
      // Nullable only because an agent may create autonomously (Q7); a project
      // with no owner is surfaced for claiming by `projects_unowned_idx`.
      ownerUserId,
    });
    if (ownerUserId) {
      // The creator is a member in their own right, so membership queries do not
      // have to special-case ownership.
      await this.repo.upsertMember(row.id, ownerUserId, 'owner', ownerUserId);
    }
    if (tagIds?.length) {
      await this.repo.setTags(row.id, tagIds, ownerUserId);
    }
    await this.projection.projectProject(row.id);
    await this.activity.recordSafe({
      principal,
      entityType: 'project',
      entityId: row.id,
      projectId: row.id,
      action: 'project.created',
      summary: `${row.key} — ${row.name}`,
    });
    return this.toPublic(row, 'owner', tagIds ?? []);
  }

  async list(dto: ListProjectsDto, principal: Principal) {
    const visibleTo =
      isAdmin(principal) || principal.kind === 'system'
        ? undefined
        : principal.kind === 'user'
          ? principal.userId
          : // A service credential owns and belongs to nothing; it sees the
            // `internal` projects the SQL predicate also matches.
            '00000000-0000-0000-0000-000000000000';
    const { rows, total } = await this.repo.list({ ...dto, visibleTo });

    // Memberships for the whole page in one query, then resolve per row in
    // memory. `accessFor` returns early for admins and the system principal, so
    // the per-row lookup it would otherwise do was invisible in admin testing
    // and only cost an ordinary user one query per project on the page.
    const memberships: Map<string, ProjectMemberRow> =
      principal.kind === 'user' && !isAdmin(principal)
        ? await this.repo.membershipsForMany(
            rows.map((r) => r.id),
            principal.userId,
          )
        : new Map();

    const enriched = rows.map((row) => ({
      row,
      access:
        isAdmin(principal) || principal.kind === 'system'
          ? ('owner' as const)
          : resolveProjectAccess(
              row,
              principal,
              memberships.get(row.id) ?? null,
            ),
    }));
    return {
      data: enriched.map((e) => this.toPublic(e.row, e.access)),
      total,
      page: dto.page,
      limit: dto.limit,
    };
  }

  async get(id: string, principal: Principal): Promise<PublicProject> {
    const { row, access } = await this.require(id, principal, 'viewer');
    const tagIds = await this.repo.tagIdsFor(id);
    return this.toPublic(row, access, tagIds);
  }

  async update(
    id: string,
    dto: UpdateProjectDto,
    principal: Principal,
  ): Promise<PublicProject> {
    const { row, access } = await this.require(id, principal, 'manager');
    if (dto.ownerUserId !== undefined && access !== 'owner') {
      throw this.errors.create(ErrorCode.FORBIDDEN, {
        message: 'Only the project owner or an admin can hand it over',
      });
    }
    if (dto.tagIds?.length) {
      await this.tags.resolveForScope(dto.tagIds, 'project');
    }
    const { tagIds, ...rest } = dto;
    const patch: Record<string, unknown> = {
      ...rest,
      startDate: this.toDateString(dto.startDate),
      dueDate: this.toDateString(dto.dueDate),
    };
    if (dto.status === 'completed' && row.status !== 'completed') {
      patch.completedAt = new Date();
    }
    if (dto.status === 'archived' && row.status !== 'archived') {
      patch.archivedAt = new Date();
    }

    const updated = await this.repo.update(id, patch);
    if (!updated) throw this.errors.create(ErrorCode.NOT_FOUND);
    if (tagIds) await this.repo.setTags(id, tagIds, userIdOrNull(principal));
    // Ownership and visibility both change who can read it.
    await this.projection.reprojectProjectAndTasks(id);
    await this.activity.recordSafe({
      principal,
      entityType: 'project',
      entityId: id,
      projectId: id,
      action: 'project.updated',
    });
    return this.toPublic(updated, access, tagIds ?? []);
  }

  async remove(id: string, principal: Principal): Promise<void> {
    await this.require(id, principal, 'owner');
    await this.repo.softDelete(id);
    await this.cascade.purgeFor('project', id);
    await this.projection.removeProject(id);
    await this.activity.recordSafe({
      principal,
      entityType: 'project',
      entityId: id,
      projectId: id,
      action: 'project.deleted',
    });
  }

  // --- members ---

  async listMembers(id: string, principal: Principal) {
    await this.require(id, principal, 'viewer');
    return this.repo.listMembers(id);
  }

  async addMember(
    id: string,
    dto: AddMemberDto,
    principal: Principal,
  ): Promise<void> {
    await this.require(id, principal, 'manager');
    await this.repo.upsertMember(
      id,
      dto.userId,
      dto.roleInProject,
      userIdOrNull(principal),
    );
    // Membership is the scope array for the project AND every task in it.
    await this.projection.reprojectProjectAndTasks(id);
    await this.activity.recordSafe({
      principal,
      entityType: 'project',
      entityId: id,
      projectId: id,
      action: 'project.member_added',
      summary: dto.roleInProject,
    });
  }

  async removeMember(
    id: string,
    userId: string,
    principal: Principal,
  ): Promise<void> {
    const { row } = await this.require(id, principal, 'manager');
    if (row.ownerUserId === userId) {
      // Removing the owner's membership would not remove their ownership, so
      // the row and the policy would disagree.
      throw this.errors.create(ErrorCode.CONFLICT, {
        message: 'Transfer ownership before removing the owner',
      });
    }
    const removed = await this.repo.removeMember(id, userId);
    if (!removed) throw this.errors.create(ErrorCode.NOT_FOUND);
    await this.projection.reprojectProjectAndTasks(id);
    await this.activity.recordSafe({
      principal,
      entityType: 'project',
      entityId: id,
      projectId: id,
      action: 'project.member_removed',
    });
  }

  // --- access ---

  /** Whether a principal may read a project — the registry's resolver. */
  async canRead(id: string, principal: Principal): Promise<boolean> {
    const row = await this.repo.findLiveById(id);
    if (!row) return false;
    return (await this.accessFor(row, principal)) !== 'none';
  }

  /** Project ids the caller can see — used to scope cross-project task lists. */
  async visibleProjectIds(principal: Principal): Promise<string[] | undefined> {
    if (isAdmin(principal) || principal.kind === 'system') return undefined;
    const userId = principal.kind === 'user' ? principal.userId : undefined;
    if (!userId) return [];
    const { rows } = await this.repo.list({
      visibleTo: userId,
      page: 1,
      limit: 500,
    });
    return rows.map((r) => r.id);
  }

  /**
   * Load a project and assert the caller holds at least `needed`.
   *
   * Everything beneath a project routes through here, which is what keeps the
   * module to one authorization path.
   */
  async require(
    id: string,
    principal: Principal,
    needed: ProjectRole,
  ): Promise<{ row: ProjectRow; access: ProjectAccess }> {
    const row = await this.repo.findLiveById(id);
    if (!row) throw this.errors.create(ErrorCode.NOT_FOUND);
    const access = await this.accessFor(row, principal);
    // A caller who cannot see the project must not learn it exists.
    if (access === 'none') throw this.errors.create(ErrorCode.NOT_FOUND);
    if (!permitsProject(access, needed)) {
      throw this.errors.create(ErrorCode.FORBIDDEN, {
        message: `This action requires the "${needed}" role on the project`,
      });
    }
    return { row, access };
  }

  private async accessFor(
    row: ProjectRow,
    principal: Principal,
  ): Promise<ProjectAccess> {
    if (isAdmin(principal) || principal.kind === 'system') return 'owner';
    const membership =
      principal.kind === 'user'
        ? await this.repo.membership(row.id, principal.userId)
        : null;
    return resolveProjectAccess(row, principal, membership);
  }

  /** The caller's own id, for routes that are meaningless without one. */
  requireUser(principal: Principal): string {
    return requireUserId(principal);
  }

  /**
   * Recompute a project's completion percentage.
   *
   * Exposed for `TaskService`, which must refresh it after every task write.
   * Routed through the service rather than by sharing the repository, so the
   * denormalization has exactly one owner.
   */
  async repoRefreshProgress(projectId: string): Promise<void> {
    await this.repo.refreshProgress(projectId);
  }
}
