import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FileUploadList } from '@/app/dashboard/file-management/components/file-upload-list'
import type { UploadItem } from '@/lib/hooks/use-file-upload'

const item = (over: Partial<UploadItem>): UploadItem => ({
  file: new File(['x'], 'a.pdf', { type: 'application/pdf' }), status: 'pending', ...over,
})

describe('FileUploadList', () => {
  it('shows each file with its status label', () => {
    render(<FileUploadList items={[item({ status: 'deduplicated' }), item({ status: 'error', error: 'boom' })]} />)
    expect(screen.getByText('Deduplicated')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
  })
})
