import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FieldSpecEditor } from '@/components/data-management/field-spec-editor'

describe('FieldSpecEditor', () => {
  it('adds a new empty field row', () => {
    const onChange = vi.fn()
    render(<FieldSpecEditor value={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /add field/i }))
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ name: '', type: 'string' })])
  })
  it('disables searchable for a number field', () => {
    render(<FieldSpecEditor value={[{ name: 'price', type: 'number' }]} onChange={() => {}} />)
    expect(screen.getByLabelText(/searchable/i)).toBeDisabled()
  })
})
