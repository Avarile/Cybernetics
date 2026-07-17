import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FieldCell } from '@/components/data-management/field-cell'

describe('FieldCell', () => {
  it('renders a dash for empty values', () => {
    render(<FieldCell field={{ name: 'x', type: 'string' }} value={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
  it('renders a badge per array item', () => {
    render(<FieldCell field={{ name: 'tags', type: 'string[]' }} value={['a', 'b']} />)
    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
  })
  it('renders Yes/No for booleans', () => {
    render(<FieldCell field={{ name: 'active', type: 'boolean' }} value={true} />)
    expect(screen.getByText('Yes')).toBeInTheDocument()
  })
})
