import { taskDependenciesConfig } from "@/components/domains/relations.config"
import { omitBlank, type RecordFormSpec } from "../record-form-spec"

/** PRIORITIES in api/src/features/projects/dto/project.dto.ts. */
const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
]

export const PROJECTS_FORMS: Record<string, RecordFormSpec> = {
  // Mirrors createProjectSchema / updateProjectSchema in
  // api/src/features/projects/dto/project.dto.ts
  projects: {
    fields: [
      {
        key: "key",
        label: "Key",
        kind: "text",
        maxLength: 20,
        createOnly: true,
        required: true,
        help: "UPPER_SNAKE_CASE. Prefixes task numbers (ACME-42) and cannot be changed later.",
      },
      { key: "name", label: "Name", kind: "text", maxLength: 255, required: true },
      { key: "description", label: "Description", kind: "textarea", maxLength: 50_000 },
      {
        key: "status",
        label: "Status",
        kind: "select",
        options: [
          { value: "draft", label: "Draft" },
          { value: "active", label: "Active" },
          { value: "on_hold", label: "On hold" },
          { value: "completed", label: "Completed" },
          { value: "archived", label: "Archived" },
          { value: "cancelled", label: "Cancelled" },
        ],
      },
      { key: "priority", label: "Priority", kind: "select", options: PRIORITY_OPTIONS },
      {
        key: "visibility",
        label: "Visibility",
        kind: "select",
        options: [
          { value: "private", label: "Private" },
          { value: "internal", label: "Internal" },
        ],
      },
      { key: "startDate", label: "Start date", kind: "date" },
      { key: "dueDate", label: "Due date", kind: "date" },
      { key: "budgetAmount", label: "Budget", kind: "text" },
      { key: "currency", label: "Currency", kind: "text", maxLength: 3 },
    ],
    validate: (v) => {
      if (!v.name?.trim()) return "A project needs a name"
      // The DTO's own regex. Checked here so a lowercase key fails before the
      // request rather than after a 422 that names a field the form calls
      // something else.
      if (v.key && !/^[A-Z][A-Z0-9_]*$/.test(v.key.trim())) {
        return "Key must be UPPER_SNAKE_CASE, starting with a letter"
      }
      return null
    },
    serialize: omitBlank,
  },

  // Mirrors createTaskSchema / updateTaskSchema in
  // api/src/features/projects/dto/task.dto.ts
  //
  // `status` is present but `blockedReason` is not: moving to `blocked`
  // requires a reason the service demands and the DTO does not declare, so
  // that transition goes through the row menu instead.
  tasks: {
    fields: [
      { key: "projectId", label: "Project", kind: "text", createOnly: true, required: true },
      { key: "title", label: "Title", kind: "text", maxLength: 500, required: true },
      { key: "description", label: "Description", kind: "textarea", maxLength: 200_000 },
      {
        key: "status",
        label: "Status",
        kind: "select",
        options: [
          { value: "backlog", label: "Backlog" },
          { value: "todo", label: "To do" },
          { value: "in_progress", label: "In progress" },
          { value: "in_review", label: "In review" },
          { value: "done", label: "Done" },
          { value: "cancelled", label: "Cancelled" },
        ],
      },
      { key: "priority", label: "Priority", kind: "select", options: PRIORITY_OPTIONS },
      { key: "estimateMinutes", label: "Estimate (minutes)", kind: "text" },
      { key: "startDate", label: "Start date", kind: "date" },
      { key: "dueDate", label: "Due date", kind: "date" },
    ],
    validate: (v) => {
      if (!v.title?.trim()) return "A task needs a title"
      if (!v.projectId?.trim()) return "A task needs a project"
      return null
    },
    serialize: omitBlank,
    relations: [{ key: "dependencies", label: "Depends on", config: taskDependenciesConfig }],
  },

  // Mirrors updateTimeSchema. `taskId` and `projectId` are DELIBERATELY
  // absent: moving an hour between projects would change which budget it
  // lands on and which invoice may bill it. Delete and re-log for that.
  time: {
    fields: [
      { key: "minutes", label: "Minutes", kind: "text", required: true },
      { key: "workDate", label: "Work date", kind: "date", required: true },
      { key: "description", label: "Description", kind: "textarea", maxLength: 500 },
      {
        key: "isBillable",
        label: "Billable",
        kind: "select",
        options: [
          { value: "false", label: "No" },
          { value: "true", label: "Yes" },
        ],
      },
      { key: "hourlyRate", label: "Hourly rate", kind: "text" },
      { key: "currency", label: "Currency", kind: "text", maxLength: 3 },
    ],
    validate: (v) => {
      const minutes = Number(v.minutes)
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 24 * 60) {
        return "Minutes must be a whole number between 1 and 1440"
      }
      if (!v.workDate?.trim()) return "A time entry needs a work date"
      return null
    },
    serialize: (v) => {
      const body = omitBlank(v)
      if (body.minutes != null) body.minutes = Number(body.minutes)
      if (body.isBillable != null) body.isBillable = body.isBillable === "true"
      return body
    },
  },

  /** POST /tasks/:id/time — the create side, where the task is in the path. */
  "time-log": {
    fields: [
      { key: "minutes", label: "Minutes", kind: "text", required: true },
      { key: "workDate", label: "Work date", kind: "date", required: true },
      { key: "description", label: "Description", kind: "textarea", maxLength: 500 },
      {
        key: "isBillable",
        label: "Billable",
        kind: "select",
        options: [
          { value: "false", label: "No" },
          { value: "true", label: "Yes" },
        ],
      },
      { key: "hourlyRate", label: "Hourly rate", kind: "text" },
      { key: "currency", label: "Currency", kind: "text", maxLength: 3 },
    ],
    validate: (v) => {
      const minutes = Number(v.minutes)
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 24 * 60) {
        return "Minutes must be a whole number between 1 and 1440"
      }
      if (!v.workDate?.trim()) return "A time entry needs a work date"
      return null
    },
    serialize: (v) => {
      const body = omitBlank(v)
      if (body.minutes != null) body.minutes = Number(body.minutes)
      if (body.isBillable != null) body.isBillable = body.isBillable === "true"
      return body
    },
  },

  milestones: {
    fields: [
      { key: "name", label: "Name", kind: "text", maxLength: 255, required: true },
      { key: "description", label: "Description", kind: "textarea", maxLength: 20_000 },
      {
        key: "status",
        label: "Status",
        kind: "select",
        options: [
          { value: "pending", label: "Pending" },
          { value: "in_progress", label: "In progress" },
          { value: "reached", label: "Reached" },
          { value: "missed", label: "Missed" },
          { value: "cancelled", label: "Cancelled" },
        ],
      },
      { key: "dueDate", label: "Due date", kind: "date" },
      { key: "sortOrder", label: "Sort order", kind: "text" },
    ],
    validate: (v) => (v.name?.trim() ? null : "A milestone needs a name"),
    serialize: omitBlank,
  },

  // Mirrors createGoalSchema, including its superRefine.
  goals: {
    fields: [
      {
        key: "kind",
        label: "Kind",
        kind: "select",
        options: [
          { value: "objective", label: "Objective" },
          { value: "key_result", label: "Key result" },
        ],
      },
      { key: "parentGoalId", label: "Parent objective", kind: "text" },
      { key: "title", label: "Title", kind: "text", maxLength: 500, required: true },
      { key: "description", label: "Description", kind: "textarea", maxLength: 20_000 },
      {
        key: "status",
        label: "Status",
        kind: "select",
        options: [
          { value: "draft", label: "Draft" },
          { value: "active", label: "Active" },
          { value: "at_risk", label: "At risk" },
          { value: "achieved", label: "Achieved" },
          { value: "missed", label: "Missed" },
          { value: "cancelled", label: "Cancelled" },
        ],
      },
      { key: "metricName", label: "Metric", kind: "text", maxLength: 120 },
      { key: "targetValue", label: "Target", kind: "text" },
      { key: "currentValue", label: "Current", kind: "text" },
      { key: "unit", label: "Unit", kind: "text", maxLength: 40 },
      {
        key: "direction",
        label: "Direction",
        kind: "select",
        help: "Without it, “current 40 of target 30” is unreadable.",
        options: [
          { value: "increase", label: "Increase" },
          { value: "decrease", label: "Decrease" },
          { value: "maintain", label: "Maintain" },
        ],
      },
      { key: "startDate", label: "Start date", kind: "date" },
      { key: "dueDate", label: "Due date", kind: "date" },
    ],
    // The DTO's superRefine, mirrored: a key result measures something
    // beneath an objective; an objective is the thing being measured towards.
    validate: (v) => {
      if (!v.title?.trim()) return "A goal needs a title"
      if (v.kind === "key_result" && !v.parentGoalId?.trim()) {
        return "A key result must belong to an objective"
      }
      if (v.kind === "objective" && v.parentGoalId?.trim()) {
        return "An objective cannot have a parent"
      }
      return null
    },
    serialize: omitBlank,
  },

  "project-members": {
    fields: [
      { key: "userId", label: "User", kind: "text", required: true },
      {
        key: "roleInProject",
        label: "Role",
        kind: "select",
        // `owner` is absent from ASSIGNABLE_MEMBER_ROLES on purpose: a project
        // has one accountable owner on projects.owner_user_id, and letting
        // this endpoint write the row let a manager grant themselves owner
        // and delete a project they did not own. Ownership moves through
        // PATCH /projects/:id alone.
        options: [
          { value: "manager", label: "Manager" },
          { value: "contributor", label: "Contributor" },
          { value: "viewer", label: "Viewer" },
        ],
      },
    ],
    validate: (v) => (v.userId?.trim() ? null : "Choose a user to add"),
    serialize: omitBlank,
  },
}
