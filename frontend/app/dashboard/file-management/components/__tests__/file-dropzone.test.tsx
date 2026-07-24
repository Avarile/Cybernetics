import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FileDropzone } from '@/app/dashboard/file-management/components/file-dropzone'

describe('FileDropzone', () => {
  it('emits dropped files', () => {
    const onFiles = vi.fn()
    render(<FileDropzone onFiles={onFiles} />)
    const zone = screen.getByTestId('file-dropzone')
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    expect(onFiles).toHaveBeenCalledWith([file])
  })

  it('emits files chosen via the input', () => {
    const onFiles = vi.fn()
    render(<FileDropzone onFiles={onFiles} />)
    const input = screen.getByTestId('file-input') as HTMLInputElement
    const file = new File(['x'], 'b.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(onFiles).toHaveBeenCalledWith([file])
  })

  it('forwards the accept attribute to the file input', () => {
    render(<FileDropzone onFiles={() => {}} accept=".pdf,.docx" />)
    expect(screen.getByTestId('file-input')).toHaveAttribute('accept', '.pdf,.docx')
  })
})
