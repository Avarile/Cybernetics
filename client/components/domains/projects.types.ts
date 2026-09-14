/**
 * Projects wire shapes.
 *
 * Split from the config so the six section definitions stay readable and so
 * `projects-actions.tsx` can import a type without importing the configs it
 * is itself imported by.
 */

export interface Project {
  id: string
  key: string
  name: string
  description: string | null
  status: "draft" | "active" | "on_hold" | "completed" | "archived" | "cancelled"
  priority: "low" | "medium" | "high" | "urgent"
  visibility: "private" | "internal"
  ownerUserId: string | null
  leadUserId: string | null
  startDate: string | null
  dueDate: string | null
  progressPct: number
  tagIds: string[]
  /** What the asking principal may do, "so a client need not guess". */
  access: "none" | "viewer" | "contributor" | "manager" | "owner"
  updatedAt: string
}

export interface Task {
  id: string
  projectId: string
  number: number
  title: string
  status: "backlog" | "todo" | "in_progress" | "blocked" | "in_review" | "done" | "cancelled"
  priority: Project["priority"]
  assigneeUserId: string | null
  milestoneId: string | null
  estimateMinutes: number | null
  spentMinutes: number
  startDate: string | null
  dueDate: string | null
  blockedReason: string | null
}

export interface TimeEntry {
  id: string
  taskId: string | null
  projectId: string
  userId: string
  minutes: number
  workDate: string
  description: string | null
  isBillable: boolean
  hourlyRate: string | null
  currency: string | null
  /** Presence of this FK is the "already invoiced" lock. */
  invoiceLineItemId: string | null
}

export interface Milestone {
  id: string
  projectId: string
  name: string
  description: string | null
  status: "pending" | "in_progress" | "reached" | "missed" | "cancelled"
  dueDate: string | null
  ownerUserId: string | null
  sortOrder: number
}

export interface Goal {
  id: string
  projectId: string | null
  parentGoalId: string | null
  kind: "objective" | "key_result"
  title: string
  status: "draft" | "active" | "at_risk" | "achieved" | "missed" | "cancelled"
  metricName: string | null
  targetValue: string | null
  currentValue: string | null
  unit: string | null
  direction: "increase" | "decrease" | "maintain" | null
  startDate: string | null
  dueDate: string | null
  progressPct: number
}

export interface ProjectMember {
  id: string
  projectId: string
  userId: string
  roleInProject: "owner" | "manager" | "contributor" | "viewer"
  joinedAt: string
}
