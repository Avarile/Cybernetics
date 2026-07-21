import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const create = vi.fn()
vi.mock('@/lib/hooks/use-record-mutations', () => ({ useRecordMutations: () => ({ create, update: create, remove: vi.fn(), reindex: vi.fn() }) }))

import { RecordForm } from '@/components/data-management/record-form'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

const fields: FieldSpec[] = [{ name: 'title', type: 'string', required: true }]

beforeEach(() => vi.clearAllMocks())

describe('RecordForm', () => {
  it('blocks submit and shows a validation error when required is empty', async () => {
    render(<RecordForm fields={fields} collection="products" mode="create" onDone={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /create record/i }))
    await waitFor(() => expect(screen.getByText(/title is required/i)).toBeInTheDocument())
    expect(create).not.toHaveBeenCalled()
  })

  it('persists a valid record with a generated externalId', async () => {
    create.mockResolvedValue({ id: 'x', externalId: 'e', indexState: 'PENDING' })
    const onDone = vi.fn()
    render(<RecordForm fields={fields} collection="products" mode="create" onDone={onDone} />)
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Laptop' } })
    fireEvent.click(screen.getByRole('button', { name: /create record/i }))
    await waitFor(() => expect(create).toHaveBeenCalled())
    const arg = create.mock.calls[0][0]
    expect(arg.document).toEqual({ title: 'Laptop' })
    expect(typeof arg.externalId).toBe('string')
    expect(arg.externalId.length).toBeGreaterThan(0)
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })

  it('seeds edit values from initialDocument', () => {
    render(
      <RecordForm
        fields={[{ name: 'title', type: 'string', required: true }]}
        collection="c" mode="edit" initialDocument={{ title: 'Seeded' }} externalId="ext-1" onDone={() => {}}
      />,
    )
    expect((screen.getByLabelText(/title/) as HTMLInputElement).value).toBe('Seeded')
  })
})
