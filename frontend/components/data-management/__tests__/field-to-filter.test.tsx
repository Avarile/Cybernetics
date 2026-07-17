import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FilterControl } from '@/components/data-management/field-to-filter'

describe('FilterControl', () => {
  it('enum: toggling a checkbox emits an array (IN)', () => {
    const onChange = vi.fn()
    render(<FilterControl field={{ name: 'status', type: 'string', enum: ['active', 'archived'] }} value={undefined} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('active'))
    expect(onChange).toHaveBeenCalledWith(['active'])
  })
  it('enum: unchecking the last value emits undefined', () => {
    const onChange = vi.fn()
    render(<FilterControl field={{ name: 'status', type: 'string', enum: ['active'] }} value={['active']} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('active'))
    expect(onChange).toHaveBeenCalledWith(undefined)
  })
  it('number: emits a number or undefined', () => {
    const onChange = vi.fn()
    render(<FilterControl field={{ name: 'price', type: 'number' }} value={undefined} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('price'), { target: { value: '10' } })
    expect(onChange).toHaveBeenCalledWith(10)
  })
  it('enum on a numeric field emits numbers, not strings', () => {
    const onChange = vi.fn()
    render(<FilterControl field={{ name: 'rating', type: 'number', enum: [1, 2, 3] }} value={undefined} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('1'))
    expect(onChange).toHaveBeenCalledWith([1])
  })
})
