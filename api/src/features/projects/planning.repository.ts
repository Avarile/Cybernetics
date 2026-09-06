import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import {
  goals,
  milestones,
  type GoalRow,
  type MilestoneRow,
  type NewGoalRow,
  type NewMilestoneRow,
} from '../../infrastructure/database/schema/project.schema';

/** Milestones and goals — the planning layer above tasks. */
@Injectable()
export class PlanningRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  listMilestones(projectId: string): Promise<MilestoneRow[]> {
    return this.db
      .select()
      .from(milestones)
      .where(
        and(
          eq(milestones.projectId, projectId),
          eq(milestones.isDeleted, false),
        ),
      )
      .orderBy(asc(milestones.sortOrder), asc(milestones.dueDate));
  }

  async findMilestone(id: string): Promise<MilestoneRow | null> {
    const rows = await this.db
      .select()
      .from(milestones)
      .where(and(eq(milestones.id, id), eq(milestones.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async createMilestone(values: NewMilestoneRow): Promise<MilestoneRow> {
    const rows = await this.db.insert(milestones).values(values).returning();
    return rows[0];
  }

  async updateMilestone(
    id: string,
    patch: Partial<NewMilestoneRow>,
  ): Promise<MilestoneRow | null> {
    const rows = await this.db
      .update(milestones)
      .set(patch)
      .where(and(eq(milestones.id, id), eq(milestones.isDeleted, false)))
      .returning();
    return rows[0] ?? null;
  }

  async softDeleteMilestone(id: string): Promise<void> {
    await this.db
      .update(milestones)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(milestones.id, id));
  }

  // --- goals ---

  /**
   * Goals for a project, plus the organizational ones.
   *
   * `project_id` is nullable because objectives exist above any single project;
   * a project view that hid them would make company goals invisible everywhere.
   */
  listGoals(projectId: string | null): Promise<GoalRow[]> {
    return this.db
      .select()
      .from(goals)
      .where(
        and(
          projectId
            ? or(eq(goals.projectId, projectId), isNull(goals.projectId))!
            : isNull(goals.projectId),
          eq(goals.isDeleted, false),
        ),
      )
      .orderBy(asc(goals.dueDate));
  }

  async findGoal(id: string): Promise<GoalRow | null> {
    const rows = await this.db
      .select()
      .from(goals)
      .where(and(eq(goals.id, id), eq(goals.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Key results beneath an objective. */
  keyResults(parentGoalId: string): Promise<GoalRow[]> {
    return this.db
      .select()
      .from(goals)
      .where(
        and(eq(goals.parentGoalId, parentGoalId), eq(goals.isDeleted, false)),
      );
  }

  async createGoal(values: NewGoalRow): Promise<GoalRow> {
    const rows = await this.db.insert(goals).values(values).returning();
    return rows[0];
  }

  async updateGoal(
    id: string,
    patch: Partial<NewGoalRow>,
  ): Promise<GoalRow | null> {
    const rows = await this.db
      .update(goals)
      .set(patch)
      .where(and(eq(goals.id, id), eq(goals.isDeleted, false)))
      .returning();
    return rows[0] ?? null;
  }

  async softDeleteGoal(id: string): Promise<void> {
    await this.db
      .update(goals)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(goals.id, id));
  }
}
