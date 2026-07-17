'use client'

import { useEffect, useState } from 'react'
import { ICall, IUpdateCallDto } from '@/lib/interfaces/call.interface'
import { IRelationRef } from '@/lib/interfaces/shared.interface'
import { GlobalModal } from '@/components/global-modal'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { RelationAutocomplete } from '@/components/relation/RelationAutocomplete'
import { RelationBadgeGroup } from '@/components/relation/RelationBadgeGroup'
import {
  searchContacts,
  searchTasks,
  searchProjects,
  searchKnowledge,
} from '@/lib/services/relation-search.service'

type CallStatus = 'failed' | 'voice_mail' | 'completed' | 'no_show'
type CallOutcome = 'success' | 'failure' | 'follow_up_required' | 'rescheduled' | 'no_outcome'

interface RecordModalProps {
  open: boolean
  mode: 'view' | 'edit'
  record: ICall | null
  onEdit: () => void
  onCancel: () => void
  onSave: (dto: IUpdateCallDto) => Promise<void>
  onClose: () => void
  isSaving?: boolean
}

const STATUS_COLORS: Record<CallStatus, string> = {
  failed: 'bg-red-100 text-red-700',
  voice_mail: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  no_show: 'bg-gray-100 text-gray-700',
}

const OUTCOME_COLORS: Record<CallOutcome, string> = {
  success: 'bg-green-100 text-green-700',
  failure: 'bg-red-100 text-red-700',
  follow_up_required: 'bg-blue-100 text-blue-700',
  rescheduled: 'bg-purple-100 text-purple-700',
  no_outcome: 'bg-gray-100 text-gray-700',
}

export function RecordModal({
  open,
  mode,
  record,
  onEdit,
  onCancel,
  onSave,
  onClose,
  isSaving,
}: RecordModalProps) {
  const [draft, setDraft] = useState<Partial<ICall>>({})

  useEffect(() => {
    if (record) {
      setDraft({
        ...record,
        contactsInvolved: record.contactsInvolved ?? [],
        knowledgeInvolved: record.knowledgeInvolved ?? [],
        projectsInvolved: record.projectsInvolved ?? [],
        taskInvolved: record.taskInvolved ?? [],
      })
    }
  }, [record, mode])

  function set<K extends keyof typeof draft>(field: K, value: (typeof draft)[K]) {
    setDraft(d => ({ ...d, [field]: value }))
  }

  function addRelation(
    field: 'contactsInvolved' | 'knowledgeInvolved' | 'projectsInvolved' | 'taskInvolved',
    item: IRelationRef
  ) {
    setDraft(d => {
      const arr = (d[field] as IRelationRef[] | undefined) ?? []
      if (arr.find(x => x.slug === item.slug)) return d
      return { ...d, [field]: [...arr, item] }
    })
  }

  function removeRelation(
    field: 'contactsInvolved' | 'knowledgeInvolved' | 'projectsInvolved' | 'taskInvolved',
    slug: string
  ) {
    setDraft(d => ({
      ...d,
      [field]: ((d[field] as IRelationRef[] | undefined) ?? []).filter(x => x.slug !== slug),
    }))
  }

  async function handleSave() {
    if (!record) return
    await onSave({ id: record.id, ...draft } as IUpdateCallDto)
  }

  if (!record) return null

  const isEdit = mode === 'edit'

  const actions = isEdit
    ? [
        { label: 'Cancel', onClick: onCancel, variant: 'outline' as const },
        { label: 'Save', onClick: handleSave, loading: isSaving },
      ]
    : [
        { label: 'Edit', onClick: onEdit },
        { label: 'Close', onClick: onClose, variant: 'outline' as const },
      ]

  const formatDuration = (seconds?: number) => {
    if (seconds == null) return '—'
    if (seconds < 60) return `${seconds}s`
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return s > 0 ? `${m}m ${s}s` : `${m}m`
  }

  return (
    <GlobalModal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Call' : 'Call Details'}
      actions={actions}
      size="lg"
    >
      {isEdit ? (
        <div className="space-y-5">
          {/* Call Details */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Call Details</p>
            <div className="rounded-lg border p-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Call ID</Label>
                  <Input
                    value={draft.callID ?? ''}
                    onChange={e => set('callID', e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Duration (seconds)</Label>
                  <Input
                    type="number"
                    value={draft.duration ?? ''}
                    onChange={e => set('duration', e.target.value === '' ? undefined : Number(e.target.value))}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <select
                    value={draft.status ?? ''}
                    onChange={e => set('status', e.target.value as CallStatus)}
                    className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="failed">Failed</option>
                    <option value="voice_mail">Voice Mail</option>
                    <option value="completed">Completed</option>
                    <option value="no_show">No Show</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Outcome</Label>
                  <select
                    value={draft.outcome ?? ''}
                    onChange={e => set('outcome', e.target.value as CallOutcome)}
                    className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="success">Success</option>
                    <option value="failure">Failure</option>
                    <option value="follow_up_required">Follow Up Required</option>
                    <option value="rescheduled">Rescheduled</option>
                    <option value="no_outcome">No Outcome</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Transcript</Label>
                <Textarea
                  value={draft.transcript ?? ''}
                  onChange={e => set('transcript', e.target.value)}
                  rows={6}
                  className="text-sm resize-none"
                />
              </div>
            </div>
          </div>

          {/* Relations */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Relations</p>
            <div className="rounded-lg border p-3 space-y-4">
              <div className="space-y-2">
                <RelationAutocomplete
                  label="Contacts Involved"
                  selected={(draft.contactsInvolved as IRelationRef[]) ?? []}
                  onAdd={item => addRelation('contactsInvolved', item)}
                  search={searchContacts}
                  searchOnEmpty
                />
                <RelationBadgeGroup
                  items={(draft.contactsInvolved as IRelationRef[]) ?? []}
                  onRemove={slug => removeRelation('contactsInvolved', slug)}
                />
              </div>
              <div className="space-y-2">
                <RelationAutocomplete
                  label="Knowledge Involved"
                  selected={(draft.knowledgeInvolved as IRelationRef[]) ?? []}
                  onAdd={item => addRelation('knowledgeInvolved', item)}
                  search={searchKnowledge}
                  searchOnEmpty
                />
                <RelationBadgeGroup
                  items={(draft.knowledgeInvolved as IRelationRef[]) ?? []}
                  onRemove={slug => removeRelation('knowledgeInvolved', slug)}
                />
              </div>
              <div className="space-y-2">
                <RelationAutocomplete
                  label="Projects Involved"
                  selected={(draft.projectsInvolved as IRelationRef[]) ?? []}
                  onAdd={item => addRelation('projectsInvolved', item)}
                  search={searchProjects}
                  searchOnEmpty
                />
                <RelationBadgeGroup
                  items={(draft.projectsInvolved as IRelationRef[]) ?? []}
                  onRemove={slug => removeRelation('projectsInvolved', slug)}
                />
              </div>
              <div className="space-y-2">
                <RelationAutocomplete
                  label="Tasks Involved"
                  selected={(draft.taskInvolved as IRelationRef[]) ?? []}
                  onAdd={item => addRelation('taskInvolved', item)}
                  search={searchTasks}
                  searchOnEmpty
                />
                <RelationBadgeGroup
                  items={(draft.taskInvolved as IRelationRef[]) ?? []}
                  onRemove={slug => removeRelation('taskInvolved', slug)}
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-start gap-4 rounded-lg border bg-muted/30 p-4">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground font-mono mb-1">{record.callID || record.slug || '—'}</p>
              <div className="flex items-center gap-2 flex-wrap">
                {record.status && (
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[record.status]}`}>
                    {record.status.replace(/_/g, ' ')}
                  </span>
                )}
                {record.outcome && (
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${OUTCOME_COLORS[record.outcome]}`}>
                    {record.outcome.replace(/_/g, ' ')}
                  </span>
                )}
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${record.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {record.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-2xl font-bold text-foreground">{formatDuration(record.duration ?? undefined)}</p>
              <p className="text-xs text-muted-foreground">Duration</p>
            </div>
          </div>

          {/* Transcript */}
          {record.transcript && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Transcript</p>
              <div className="rounded-lg border px-3 py-2.5 text-sm whitespace-pre-wrap max-h-48 overflow-y-auto bg-muted/20">
                {record.transcript}
              </div>
            </div>
          )}

          {/* Relations */}
          {(
            (record.contactsInvolved?.length ?? 0) > 0 ||
            (record.knowledgeInvolved?.length ?? 0) > 0 ||
            (record.projectsInvolved?.length ?? 0) > 0 ||
            (record.taskInvolved?.length ?? 0) > 0
          ) && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Relations</p>
              <div className="rounded-lg border divide-y text-sm">
                {(record.contactsInvolved?.length ?? 0) > 0 && (
                  <div className="grid grid-cols-[140px_1fr] items-start gap-2 px-3 py-2.5">
                    <span className="text-xs text-muted-foreground pt-0.5">Contacts</span>
                    <RelationBadgeGroup items={record.contactsInvolved ?? []} />
                  </div>
                )}
                {(record.knowledgeInvolved?.length ?? 0) > 0 && (
                  <div className="grid grid-cols-[140px_1fr] items-start gap-2 px-3 py-2.5">
                    <span className="text-xs text-muted-foreground pt-0.5">Knowledge</span>
                    <RelationBadgeGroup items={record.knowledgeInvolved ?? []} />
                  </div>
                )}
                {(record.projectsInvolved?.length ?? 0) > 0 && (
                  <div className="grid grid-cols-[140px_1fr] items-start gap-2 px-3 py-2.5">
                    <span className="text-xs text-muted-foreground pt-0.5">Projects</span>
                    <RelationBadgeGroup items={record.projectsInvolved ?? []} />
                  </div>
                )}
                {(record.taskInvolved?.length ?? 0) > 0 && (
                  <div className="grid grid-cols-[140px_1fr] items-start gap-2 px-3 py-2.5">
                    <span className="text-xs text-muted-foreground pt-0.5">Tasks</span>
                    <RelationBadgeGroup items={record.taskInvolved ?? []} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Record Info */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Record Info</p>
            <div className="rounded-lg border divide-y text-sm">
              <div className="grid grid-cols-[140px_1fr] items-center gap-2 px-3 py-2.5">
                <span className="text-xs text-muted-foreground">Created</span>
                <span className="text-muted-foreground text-xs">{record.createdAt ? new Date(record.createdAt).toLocaleString() : '—'}</span>
              </div>
              <div className="grid grid-cols-[140px_1fr] items-center gap-2 px-3 py-2.5">
                <span className="text-xs text-muted-foreground">Updated</span>
                <span className="text-muted-foreground text-xs">{record.updatedAt ? new Date(record.updatedAt).toLocaleString() : '—'}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </GlobalModal>
  )
}
