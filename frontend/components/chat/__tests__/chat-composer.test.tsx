import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatComposer } from '@/components/chat/chat-composer'

const addFiles = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/hooks/use-chat-attachments', () => ({
  useChatAttachments: () => ({ items: [], addFiles, reset: vi.fn(), rejectedCount: 0 }),
}))

describe('ChatComposer', () => {
  it('sends the typed text on submit (Enter) and clears the textbox', async () => {
    const onSend = vi.fn()
    render(<ChatComposer status="ready" onSend={onSend} />)
    const box = screen.getByRole('textbox')
    await userEvent.type(box, 'hello there')
    await userEvent.keyboard('{Enter}')
    expect(onSend).toHaveBeenCalledWith('hello there')
    expect(box).toHaveValue('')
  })

  it('does not call onSend for whitespace-only input', async () => {
    const onSend = vi.fn()
    render(<ChatComposer status="ready" onSend={onSend} />)
    const box = screen.getByRole('textbox')
    await userEvent.type(box, '   ')
    await userEvent.keyboard('{Enter}')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('shows a stop affordance while streaming', () => {
    const onStop = vi.fn()
    render(<ChatComposer status="streaming" onSend={vi.fn()} onStop={onStop} />)
    // the submit button becomes a stop button (type=button) while streaming
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument()
  })

  it('routes selected files to the attachments hook', async () => {
    const { container } = render(<ChatComposer status="ready" onSend={vi.fn()} conversationId="c1" />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(input, { target: { files: [file] } })
    expect(addFiles).toHaveBeenCalledWith([file])
  })
})
