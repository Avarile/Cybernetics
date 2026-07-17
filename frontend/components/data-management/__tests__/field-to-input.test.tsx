import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useForm } from 'react-hook-form'
import { RecordFieldInput } from '@/components/data-management/field-to-input'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

function Harness({ field }: { field: FieldSpec }) {
  const { control } = useForm<Record<string, unknown>>({ defaultValues: {} })
  return <RecordFieldInput field={field} control={control} />
}

describe('RecordFieldInput', () => {
  it('renders a labeled text input for a string field', () => {
    render(<Harness field={{ name: 'title', type: 'string' }} />)
    expect(screen.getByLabelText('title')).toBeInTheDocument()
  })
  it('renders a select for an enum field', () => {
    render(<Harness field={{ name: 'status', type: 'string', enum: ['active', 'archived'] }} />)
    expect(screen.getByLabelText('status')).toBeInTheDocument()
  })
  it('renders a number input for a number field', () => {
    render(<Harness field={{ name: 'price', type: 'number' }} />)
    expect(screen.getByLabelText('price')).toHaveAttribute('type', 'number')
  })
  it('lets a number field hold a decimal without truncating', () => {
    render(<Harness field={{ name: 'price', type: 'number' }} />)
    const input = screen.getByLabelText('price') as HTMLInputElement
    fireEvent.change(input, { target: { value: '1.5' } })
    expect(input.value).toBe('1.5')
  })
})
