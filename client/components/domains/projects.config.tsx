import { FolderKanbanIcon } from "lucide-react"
import type { DomainTableConfig } from "@/components/data-table/types"
import type { DomainSpec } from "@/components/data-window/types"
import type {
  Goal,
  Milestone,
  Project,
  ProjectMember,
  Task,
  TimeEntry,
} from "./projects.types"
import {
  DateCell,
  Duration,
  Money,
  PRIORITY_STYLES,
  ProgressCell,
  StatusBadge,
  dash,
  type StatusStyle,
} from "./cells"
import { useProjectLookups, useTaskExtras, useTaskRef } from "./projects-actions"

/** Mirrors `PublicProject` in `api/src/features/projects/project.mapper.ts`. */
const PROJECT_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On hold" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
  { value: "cancelled", label: "Cancelled" },
]

const PROJECT_STATUS_STYLES: Record<string, StatusStyle> = {
  draft: { label: "Draft", variant: "outline" },
  active: { label: "Active", variant: "default" },
  on_hold: { label: "On hold", variant: "secondary" },
  completed: { label: "Completed", variant: "secondary" },
  archived: { label: "Archived", variant: "secondary" },
  cancelled: { label: "Cancelled", variant: "destructive" },
}

const TASK_STATUSES = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "in_review", label: "In review" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
]

const TASK_STATUS_STYLES: Record<string, StatusStyle> = {
  backlog: { label: "Backlog", variant: "outline" },
  todo: { label: "To do", variant: "outline" },
  in_progress: { label: "In progress", variant: "default" },
  blocked: { label: "Blocked", variant: "destructive" },
  in_review: { label: "In review", variant: "secondary" },
  done: { label: "Done", variant: "secondary" },
  cancelled: { label: "Cancelled", variant: "secondary" },
}

const MILESTONE_STATUS_STYLES: Record<string, StatusStyle> = {
  pending: { label: "Pending", variant: "outline" },
  in_progress: { label: "In progress", variant: "default" },
  reached: { label: "Reached", variant: "secondary" },
  missed: { label: "Missed", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "secondary" },
}

const GOAL_STATUS_STYLES: Record<string, StatusStyle> = {
  draft: { label: "Draft", variant: "outline" },
  active: { label: "Active", variant: "default" },
  at_risk: { label: "At risk", variant: "destructive" },
  achieved: { label: "Achieved", variant: "secondary" },
  missed: { label: "Missed", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "secondary" },
}

const MEMBER_ROLE_STYLES: Record<string, StatusStyle> = {
  owner: { label: "Owner", variant: "default" },
  manager: { label: "Manager", variant: "default" },
  contributor: { label: "Contributor", variant: "secondary" },
  viewer: { label: "Viewer", variant: "outline" },
}

const DIRECTION_ARROW: Record<string, string> = {
  increase: "↑",
  decrease: "↓",
  maintain: "→",
}

export const projectsConfig: DomainTableConfig<Project> = {
  key: "projects",
  title: "Projects",
  endpoint: "/projects",
  searchable: true,
  canCreate: true,
  // `access` is the server telling us what this principal may do to this row.
  canEdit: (r) => r.access === "manager" || r.access === "owner",
  canDelete: (r) => r.access === "owner",
  permissions: {
    create: "project.create",
    update: "project.update",
    delete: "project.delete",
  },
  emptyMessage: "No projects match this view.",
  tabs: [
    { value: "all", label: "All", query: {} },
    { value: "active", label: "Active", query: { status: "active" } },
    { value: "on_hold", label: "On hold", query: { status: "on_hold" } },
    { value: "completed", label: "Completed", query: { status: "completed" } },
    { value: "archived", label: "Archived", query: { status: "archived" } },
  ],
  filters: [
    { key: "status", label: "Status", options: PROJECT_STATUSES },
    {
      key: "ownerUserId",
      label: "Owner",
      source: { endpoint: "/users", labelKey: "email" },
      searchable: true,
    },
  ],
  columns: [
    {
      key: "key",
      header: "Key",
      cell: (r) => <code className="text-xs font-medium">{r.key}</code>,
      hideable: false,
    },
    { key: "name", header: "Name", cell: (r) => <span className="font-medium">{r.name}</span> },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusBadge value={r.status} map={PROJECT_STATUS_STYLES} />,
    },
    {
      key: "priority",
      header: "Priority",
      cell: (r) => <StatusBadge value={r.priority} map={PRIORITY_STYLES} />,
    },
    {
      key: "progressPct",
      header: "Progress",
      cell: (r) => <ProgressCell value={r.progressPct} total={100} thresholdPct={101} />,
    },
    { key: "dueDate", header: "Due", cell: (r) => <DateCell value={r.dueDate} /> },
    {
      key: "access",
      header: "Your access",
      cell: (r) => <span className="text-xs text-muted-foreground">{r.access}</span>,
    },
  ],
}

export const tasksConfig: DomainTableConfig<Task> = {
  key: "tasks",
  title: "Tasks",
  endpoint: "/tasks",
  searchable: true,
  canCreate: true,
  canEdit: true,
  canDelete: true,
  permissions: {
    create: "project.task.create",
    update: "project.task.update",
    delete: "project.task.delete",
  },
  emptyMessage: "No tasks match this view.",
  tabs: [
    { value: "all", label: "All", query: {} },
    { value: "todo", label: "To do", query: { status: "todo" } },
    { value: "in_progress", label: "In progress", query: { status: "in_progress" } },
    { value: "blocked", label: "Blocked", query: { status: "blocked" } },
    { value: "in_review", label: "In review", query: { status: "in_review" } },
    { value: "done", label: "Done", query: { status: "done" } },
  ],
  filters: [
    { key: "projectId", label: "Project", source: { endpoint: "/projects", labelKey: "name" }, searchable: true },
    { key: "status", label: "Status", options: TASK_STATUSES },
    {
      key: "assigneeUserId",
      label: "Assignee",
      source: { endpoint: "/users", labelKey: "email" },
      searchable: true,
    },
  ],
  columns: [
    // `Ref` is composed from the project lookup — the row carries only
    // `projectId` and `number`, and "#42" alone does not identify a task.
    { key: "number", header: "Ref", cell: (r) => <TaskRef task={r} />, hideable: false },
    { key: "title", header: "Title", cell: (r) => <span className="font-medium">{r.title}</span> },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusBadge value={r.status} map={TASK_STATUS_STYLES} />,
    },
    {
      key: "priority",
      header: "Priority",
      cell: (r) => <StatusBadge value={r.priority} map={PRIORITY_STYLES} />,
    },
    { key: "assigneeUserId", header: "Assignee", cell: (r) => <Assignee id={r.assigneeUserId} /> },
    { key: "dueDate", header: "Due", cell: (r) => <DateCell value={r.dueDate} /> },
    {
      key: "spentMinutes",
      header: "Spent / est.",
      numeric: true,
      cell: (r) => (
        <span className="text-xs tabular-nums">
          <Duration minutes={r.spentMinutes} />
          {r.estimateMinutes != null && (
            <span className="text-muted-foreground">
              {" / "}
              <Duration minutes={r.estimateMinutes} />
            </span>
          )}
        </span>
      ),
    },
  ],
}

export const timeConfig: DomainTableConfig<TimeEntry> = {
  // No `GET /:id` on this endpoint (verified live) — seed from the row.
  noItemEndpoint: true,
  key: "time",
  title: "Time entries",
  // The list is /tasks/time and the item is /tasks/time/:entryId, so the
  // generic `${endpoint}/${id}` composition is correct with this endpoint.
  endpoint: "/tasks/time",
  canCreate: false,
  // An entry already on an invoice is locked: the FK is what stops one hour
  // being billed twice, and editing its minutes behind that would desync the
  // invoice from the ledger.
  canEdit: (r) => !r.invoiceLineItemId,
  canDelete: (r) => !r.invoiceLineItemId,
  permissions: { update: "project.time.log", delete: "project.time.log" },
  emptyMessage: "No time logged for this view.",
  filters: [
    { key: "projectId", label: "Project", source: { endpoint: "/projects", labelKey: "name" }, searchable: true },
    { key: "userId", label: "Who", source: { endpoint: "/users", labelKey: "email" }, searchable: true },
  ],
  columns: [
    { key: "workDate", header: "Date", cell: (r) => <DateCell value={r.workDate} />, hideable: false },
    { key: "projectId", header: "Project", cell: (r) => <ProjectName id={r.projectId} /> },
    { key: "userId", header: "Who", cell: (r) => <Assignee id={r.userId} /> },
    { key: "minutes", header: "Duration", cell: (r) => <Duration minutes={r.minutes} />, numeric: true },
    { key: "description", header: "Description", cell: (r) => dash(r.description) },
    {
      key: "isBillable",
      header: "Billable",
      cell: (r) => (r.isBillable ? <span className="text-xs">Yes</span> : dash(null)),
    },
    {
      key: "hourlyRate",
      header: "Rate",
      numeric: true,
      cell: (r) => <Money amount={r.hourlyRate} currency={r.currency} />,
    },
    {
      key: "invoiceLineItemId",
      header: "Invoiced",
      cell: (r) => <InvoicedLock entry={r} />,
    },
  ],
}

export const milestonesConfig = (projectId: string): DomainTableConfig<Milestone> => ({
  key: "milestones",
  title: "Milestones",
  endpoint: `/projects/${projectId}/milestones`,
  source: "collection",
  searchable: true,
  canCreate: true,
  canEdit: true,
  canDelete: true,
  permissions: { create: "project.update", update: "project.update", delete: "project.update" },
  emptyMessage: "No milestones for this project.",
  defaultSort: { key: "sortOrder", dir: "asc" },
  columns: [
    { key: "name", header: "Name", cell: (r) => <span className="font-medium">{r.name}</span>, hideable: false },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusBadge value={r.status} map={MILESTONE_STATUS_STYLES} />,
    },
    { key: "dueDate", header: "Due", cell: (r) => <DateCell value={r.dueDate} /> },
    { key: "ownerUserId", header: "Owner", cell: (r) => <Assignee id={r.ownerUserId} /> },
    { key: "sortOrder", header: "Order", cell: (r) => r.sortOrder, numeric: true },
  ],
})

export const goalsConfig = (projectId: string): DomainTableConfig<Goal> => ({
  key: "goals",
  title: "Goals",
  endpoint: `/projects/${projectId}/goals`,
  source: "collection",
  searchable: true,
  canCreate: true,
  canEdit: true,
  canDelete: true,
  permissions: { create: "project.update", update: "project.update", delete: "project.update" },
  emptyMessage: "No goals for this project.",
  columns: [
    {
      key: "title",
      header: "Title",
      hideable: false,
      // A key result belongs beneath its objective; indenting is the only
      // thing that makes "current 40 of target 30" legible in a flat list.
      cell: (r) => (
        <span
          className="font-medium"
          style={{ paddingLeft: r.kind === "key_result" ? "16px" : undefined }}
        >
          {r.title}
        </span>
      ),
    },
    {
      key: "kind",
      header: "Kind",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.kind === "key_result" ? "Key result" : "Objective"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusBadge value={r.status} map={GOAL_STATUS_STYLES} />,
    },
    { key: "metricName", header: "Metric", cell: (r) => dash(r.metricName) },
    {
      key: "currentValue",
      header: "Current / target",
      numeric: true,
      // Without the direction arrow, "current 40 of target 30" is unreadable
      // — the DTO's own comment on why `direction` exists.
      cell: (r) =>
        r.targetValue == null ? (
          dash(null)
        ) : (
          <span className="text-xs tabular-nums">
            {r.currentValue ?? "0"} {DIRECTION_ARROW[r.direction ?? ""] ?? "/"} {r.targetValue}
            {r.unit && <span className="ml-1 text-muted-foreground">{r.unit}</span>}
          </span>
        ),
    },
    { key: "dueDate", header: "Due", cell: (r) => <DateCell value={r.dueDate} /> },
  ],
})

export const membersConfig = (projectId: string): DomainTableConfig<ProjectMember> => ({
  key: "project-members",
  // No `GET /:id` on this endpoint (verified live) — seed from the row.
  noItemEndpoint: true,
  title: "Members",
  endpoint: `/projects/${projectId}/members`,
  source: "collection",
  canCreate: true,
  // No PATCH on a membership — change the role by removing and re-adding.
  canEdit: false,
  canDelete: true,
  // DELETE /projects/:id/members/:userId — the path wants the user, not the
  // membership row.
  deleteKey: (r) => r.userId,
  permissions: { create: "project.manage_members", delete: "project.manage_members" },
  emptyMessage: "No members on this project.",
  columns: [
    { key: "userId", header: "User", cell: (r) => <Assignee id={r.userId} />, hideable: false },
    {
      key: "roleInProject",
      header: "Role",
      cell: (r) => <StatusBadge value={r.roleInProject} map={MEMBER_ROLE_STYLES} />,
    },
    { key: "joinedAt", header: "Added", cell: (r) => <DateCell value={r.joinedAt} /> },
  ],
})

// ── cells that need a lookup ────────────────────────────────────────────────
// Components, not inline calls: `useLookup` is a hook and a `cell` callback
// runs inside `.map()`.

function TaskRef({ task }: { task: Task }) {
  return <code className="text-xs font-medium">{useTaskRef(task)}</code>
}

function ProjectName({ id }: { id: string | null }) {
  const { project } = useProjectLookups()
  return <span className="text-xs">{project.label(id)}</span>
}

function Assignee({ id }: { id: string | null }) {
  const { user } = useProjectLookups()
  return <span className="text-xs">{user.label(id)}</span>
}

function InvoicedLock({ entry }: { entry: TimeEntry }) {
  if (!entry.invoiceLineItemId) return dash(null)
  return (
    <span className="text-xs text-muted-foreground" title="Already billed on an invoice">
      Billed
    </span>
  )
}

export const projectsDomain: DomainSpec = {
  key: "projects",
  label: "Projects",
  icon: FolderKanbanIcon,
  sections: [
    {
      key: "projects",
      label: "Projects",
      body: { kind: "table", config: projectsConfig, titleOf: (r: Project) => r.name },
    },
    {
      key: "tasks",
      label: "Tasks",
      body: {
        kind: "table",
        config: tasksConfig,
        titleOf: (r: Task) => r.title,
        useExtras: useTaskExtras,
      },
    },
    {
      key: "time",
      label: "Time",
      body: { kind: "table", config: timeConfig, titleOf: (r: TimeEntry) => r.workDate },
    },
    {
      key: "milestones",
      label: "Milestones",
      body: {
        kind: "scoped-table",
        scope: {
          param: "projectId",
          from: "/projects",
          labelKey: "name",
          placeholder: "Choose a project to see its milestones",
        },
        config: milestonesConfig,
        titleOf: (r: Milestone) => r.name,
      },
    },
    {
      key: "goals",
      label: "Goals",
      body: {
        kind: "scoped-table",
        scope: {
          param: "projectId",
          from: "/projects",
          labelKey: "name",
          placeholder: "Choose a project to see its goals",
        },
        config: goalsConfig,
        titleOf: (r: Goal) => r.title,
      },
    },
    {
      key: "members",
      label: "Members",
      secondary: true,
      body: {
        kind: "scoped-table",
        scope: {
          param: "projectId",
          from: "/projects",
          labelKey: "name",
          placeholder: "Choose a project to see its members",
        },
        config: membersConfig,
        titleOf: (r: ProjectMember) => r.userId,
      },
    },
  ],
}
