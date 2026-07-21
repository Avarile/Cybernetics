import { describe, it, expect } from 'vitest'
import { buildFileColumns } from '@/app/dashboard/file-management/components/file-columns'

describe('buildFileColumns', () => {
  it('produces the expected column ids in order', () => {
    const ids = buildFileColumns().map((c) => c.id ?? (c as { accessorKey?: string }).accessorKey)
    expect(ids).toEqual(['name', 'type', 'size', 'status', 'created'])
  })
})
