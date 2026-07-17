"use client"
import { useEffect, useState } from "react"
import { GlobalModal, ConfirmDelete } from "@/components/global-modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { GlobalLoading } from "@/components/global-loading"
import { IconPlus, IconPencil, IconTrash, IconEye, IconSearch } from "@tabler/icons-react"
import { useCallStore } from "@/lib/state-management/call.store"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeftDoubleIcon, ArrowLeft01Icon, ArrowRight01Icon, ArrowRightDoubleIcon } from "@hugeicons/core-free-icons"
import { CallForm, type CallFormValues } from "./components/CallForm"
import { RecordModal } from "./components/RecordModal"
import type { ICall, IUpdateCallDto, CallStatus, CallOutcome } from "@/lib/interfaces/call.interface"

type Mode = null | "create"

const STATUS_VARIANT: Record<CallStatus, "default" | "secondary" | "destructive" | "outline"> = {
  completed: "default",
  failed: "destructive",
  voice_mail: "secondary",
  no_show: "outline",
}

const OUTCOME_VARIANT: Record<CallOutcome, "default" | "secondary" | "destructive" | "outline"> = {
  success: "default",
  failure: "destructive",
  follow_up_required: "secondary",
  rescheduled: "secondary",
  no_outcome: "outline",
}

export default function CallsPage() {
  const { items, isLoading, error, fetchAll, create, update, remove, page, pageSize, total, setPage } = useCallStore()
  const [query, setQuery] = useState("")
  const [mode, setMode] = useState<Mode>(null)
  const [deleteTarget, setDeleteTarget] = useState<ICall | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [modalRecord, setModalRecord] = useState<ICall | null>(null)
  const [modalMode, setModalMode] = useState<'view' | 'edit'>('view')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  const filtered = items.filter((i) =>
    JSON.stringify(i).toLowerCase().includes(query.toLowerCase())
  )

  async function handleSubmit(values: CallFormValues) {
    setIsPending(true)
    try {
      if (mode === "create") {
        await create({
          callID: values.callID || null,
          status: values.status,
          outcome: values.outcome,
          transcript: values.transcript || null,
          duration: values.duration ? Number(values.duration) : null,
        })
      }
      setMode(null)
    } finally {
      setIsPending(false)
    }
  }

  async function handleRecordSave(dto: IUpdateCallDto) {
    setIsSaving(true)
    try {
      await update(dto)
      const refreshed = useCallStore.getState().items.find((i) => i.id === dto.id)
      if (refreshed) setModalRecord(refreshed)
      setModalMode('view')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await remove(deleteTarget.id)
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="p-6 space-y-4">
      {/* Top bar */}
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-semibold shrink-0">Calls</h1>
        <div className="relative flex-1 max-w-sm">
          <IconSearch className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search…"
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button className="ml-auto" onClick={() => setMode("create")}>
          <IconPlus className="mr-1 h-4 w-4" />
          New Call
        </Button>
      </div>

      {isLoading && items.length === 0 && <GlobalLoading />}
      {error && <p className="text-destructive text-sm">{error}</p>}

      {/* Table */}
      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Call ID</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Outcome</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Duration</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Created</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((call) => (
              <tr key={call.id} className="border-b hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => { setModalRecord(call); setModalMode('view') }}>
                <td className="px-4 py-3 text-muted-foreground">{call.callID || "—"}</td>
                <td className="px-4 py-3">
                  <Badge variant={STATUS_VARIANT[call.status] ?? "outline"}>
                    {call.status}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge variant={OUTCOME_VARIANT[call.outcome] ?? "outline"}>
                    {call.outcome}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {call.duration != null ? `${call.duration}s` : "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {call.createdAt ? new Date(call.createdAt).toLocaleDateString() : "—"}
                </td>
                <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => { setModalRecord(call); setModalMode('view') }}>
                      <IconEye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => { setModalRecord(call); setModalMode('edit') }}>
                      <IconPencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(call)}
                    >
                      <IconTrash className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && !isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No calls found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="flex items-center justify-end px-2">
          <div className="flex w-full items-center gap-8 lg:w-fit">
            <div className="flex w-fit items-center justify-center text-sm font-medium">
              Page {page} of {Math.ceil(total / pageSize)}
            </div>
            <div className="ml-auto flex items-center gap-2 lg:ml-0">
              <Button
                variant="outline"
                className="hidden h-8 w-8 p-0 lg:flex"
                onClick={() => setPage(1)}
                disabled={page <= 1}
              >
                <span className="sr-only">Go to first page</span>
                <HugeiconsIcon icon={ArrowLeftDoubleIcon} strokeWidth={2} />
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => setPage(page - 1)}
                disabled={page <= 1}
              >
                <span className="sr-only">Go to previous page</span>
                <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => setPage(page + 1)}
                disabled={page >= Math.ceil(total / pageSize)}
              >
                <span className="sr-only">Go to next page</span>
                <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
              </Button>
              <Button
                variant="outline"
                className="hidden size-8 lg:flex"
                size="icon"
                onClick={() => setPage(Math.ceil(total / pageSize))}
                disabled={page >= Math.ceil(total / pageSize)}
              >
                <span className="sr-only">Go to last page</span>
                <HugeiconsIcon icon={ArrowRightDoubleIcon} strokeWidth={2} />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      <GlobalModal
        open={mode === "create"}
        onClose={() => setMode(null)}
        title="New Call"
      >
        <CallForm
          defaultValues={undefined}
          onSubmit={handleSubmit}
          onCancel={() => setMode(null)}
          isPending={isPending}
        />
      </GlobalModal>

      {/* Record Detail/Edit Modal */}
      <RecordModal
        open={!!modalRecord}
        mode={modalMode}
        record={modalRecord}
        onEdit={() => setModalMode('edit')}
        onCancel={() => setModalMode('view')}
        onSave={handleRecordSave}
        onClose={() => { setModalRecord(null); setModalMode('view') }}
        isSaving={isSaving}
      />

      {/* Confirm Delete */}
      <ConfirmDelete
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        label={deleteTarget ? `"${deleteTarget.callID || deleteTarget.id}"` : "this call"}
        loading={deleting}
      />
    </div>
  )
}
