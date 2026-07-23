'use client'

import useSWR from 'swr'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { fileService } from '@/lib/services/file.service'
import { useFileStatus, useFileManagementStore } from '@/lib/state-management/file-management.store'
import type { FileStatusFilter } from '@/lib/interfaces/search.interface'

const TABS: { value: FileStatusFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'AVAILABLE', label: 'Available' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'QUARANTINED', label: 'Quarantined' },
]

export function FileStatusTabs() {
  const status = useFileStatus()
  const setStatus = useFileManagementStore((s) => s.setStatus)
  const { data: quarantined } = useSWR<number>(
    ['files-count', 'QUARANTINED'],
    () => fileService.list({ status: 'QUARANTINED', page: 1, limit: 1 }).then((r) => r.total),
  )

  return (
    <div className="px-4 lg:px-6">
      <Tabs value={status} onValueChange={(v) => setStatus(v as FileStatusFilter)}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="gap-1.5">
              {t.label}
              {t.value === 'QUARANTINED' && !!quarantined && quarantined > 0 && (
                <Badge variant="destructive" className="h-5 px-1.5">{quarantined}</Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}
