import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FileStatusBadge } from '@/app/dashboard/file-management/components/file-status-badge'

describe('FileStatusBadge', () => {
  it('renders the humanized status label', () => {
    render(<FileStatusBadge status="AVAILABLE" />)
    expect(screen.getByText('Available')).toBeInTheDocument()
  })
  it('renders quarantined with the reason in the title', () => {
    render(<FileStatusBadge status="QUARANTINED" reason="mime-mismatch" />)
    expect(screen.getByText('Quarantined')).toBeInTheDocument()
    expect(screen.getByText('Quarantined').closest('[title]')).toHaveAttribute('title', expect.stringContaining('mime-mismatch'))
  })
})
