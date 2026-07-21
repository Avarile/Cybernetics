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
  it('renders a locale date for a parseable date value', () => {
    render(<FieldCell field={{ name: 'when', type: 'date' }} value="2026-01-15" />)
    expect(screen.getByText(new Date('2026-01-15').toLocaleDateString())).toBeInTheDocument()
  })
  it('falls back to the raw value for an unparseable date', () => {
    render(<FieldCell field={{ name: 'when', type: 'date' }} value="not-a-date" />)
    expect(screen.getByText('not-a-date')).toBeInTheDocument()
  })
  it('renders an enum value as a badge', () => {
    render(<FieldCell field={{ name: 'status', type: 'string', enum: ['active', 'archived'] }} value="active" />)
    expect(screen.getByText('active')).toBeInTheDocument()
  })
  it('renders plain string values as text', () => {
    render(<FieldCell field={{ name: 'title', type: 'string' }} value="Hello world" />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })
  it('renders highlight marks for a string field', () => {
    render(
      <FieldCell field={{ name: 'title', type: 'string' }} value="hello world" highlighted="<em>hello</em> world" />
    )
    expect(screen.getByText('hello')).toBeInTheDocument()
  })
  it('escapes script tags in highlighted content instead of executing them', () => {
    const { container } = render(
      <FieldCell
        field={{ name: 'title', type: 'string' }}
        value="hello"
        highlighted='<script>window.__pwned = true</script><em>hello</em>'
      />
    )
    expect(container.querySelector('script')).toBeNull()
    expect(screen.getByText('hello')).toBeInTheDocument()
  })
})
