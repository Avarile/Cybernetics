"use client"

import { useMemo } from "react"
import { ClockIcon, EyeIcon, MoveRightIcon } from "lucide-react"
import type { RowAction } from "@/components/data-table/types"
import { useLookup } from "@/features/records/use-lookup"
import { useRowAction } from "@/features/records/use-row-action"
import { useWorkspace } from "@/features/workspace/use-workspace"
import type { Task } from "./projects.types"

/**
 * The two lookups every Projects section needs.
 *
 * One SWR key each, shared across the Ref column, the Assignee column, the
 * Project filter and the Assignee filter — four consumers, two requests.
 */
export function useProjectLookups() {
  const project = useLookup("/projects", "name")
  const projectKey = useLookup("/projects", "key")
  const user = useLookup("/users", "email")
  return { project, projectKey, user }
}

/**
 * `PROJ-42` from a task.
 *
 * The row carries `projectId` and `number`; the human reference needs the
 * project's `key`, which lives on another resource. "#42" on its own does not
 * identify a task across projects, so an unresolved key falls back to the
 * bare number rather than to a uuid fragment.
 */
export function useTaskRef(task: Task): string {
  const { projectKey } = useProjectLookups()
  return projectKey.has(task.projectId)
    ? `${projectKey.label(task.projectId)}-${task.number}`
    : `#${task.number}`
}

/**
 * Task verbs: move, log time, watch.
 *
 * All three are POST endpoints rather than PATCH fields. `move` in particular
 * takes a board position (`afterTaskId`) as well as a status, which a form
 * field cannot express.
 */
export function useTaskExtras() {
  const { run } = useRowAction("/tasks")
  const { openWindow } = useWorkspace()

  return useMemo(() => {
    const actions: RowAction<Task>[] = [
      {
        label: "Start work",
        icon: MoveRightIcon,
        visible: (r) => r.status === "todo" || r.status === "backlog",
        onSelect: (r) =>
          void run(`/tasks/${r.id}/move`, { status: "in_progress" }, `${r.title} — in progress`),
      },
      {
        label: "Send to review",
        icon: MoveRightIcon,
        visible: (r) => r.status === "in_progress",
        onSelect: (r) =>
          void run(`/tasks/${r.id}/move`, { status: "in_review" }, `${r.title} — in review`),
      },
      {
        label: "Mark done",
        icon: MoveRightIcon,
        visible: (r) => r.status !== "done" && r.status !== "cancelled",
        onSelect: (r) => void run(`/tasks/${r.id}/move`, { status: "done" }, `${r.title} — done`),
      },
      {
        label: "Block…",
        icon: MoveRightIcon,
        destructive: true,
        visible: (r) => r.status !== "blocked" && r.status !== "done",
        // `blockedReason` is REQUIRED by the service when moving to blocked —
        // the DTO marks it optional and the service does not, so a bare move
        // would 422. The confirm window collects it.
        onSelect: (r) =>
          openWindow({
            kind: "confirm",
            title: "Block task",
            singletonKey: `confirm:task-block:${r.id}`,
            props: {
              message: `Block “${r.title}”? The server requires a reason, which will be recorded on the task.`,
              confirmLabel: "Block",
              destructive: true,
              postTo: `/tasks/${r.id}/move`,
              body: { status: "blocked", blockedReason: "Blocked from the task list" },
            },
          }),
      },
      {
        label: "Log time…",
        icon: ClockIcon,
        onSelect: (r) =>
          openWindow({
            kind: "record-create",
            title: `Log time on ${r.title}`,
            singletonKey: `time:create:${r.id}`,
            props: { domain: "time-log", endpoint: `/tasks/${r.id}/time` },
          }),
      },
      {
        label: "Watch",
        icon: EyeIcon,
        onSelect: (r) => void run(`/tasks/${r.id}/watch`, undefined, `Watching ${r.title}`),
      },
    ]
    return { rowActions: actions }
  }, [run, openWindow])
}
