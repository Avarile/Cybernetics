import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RecordStatusBadge } from '@/components/data-management/record-status-badge'

describe('RecordStatusBadge', () => {
  it('shows Indexing for PENDING', () => { render(<RecordStatusBadge state="PENDING" />); expect(screen.getByText('Indexing')).toBeInTheDocument() })
  it('shows Indexed for INDEXED', () => { render(<RecordStatusBadge state="INDEXED" />); expect(screen.getByText('Indexed')).toBeInTheDocument() })
  it('shows Failed for FAILED', () => { render(<RecordStatusBadge state="FAILED" />); expect(screen.getByText('Failed')).toBeInTheDocument() })
})
