import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatComposer } from '@/components/chat/chat-composer'

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
    expect(screen.getByRole('button')).toBeInTheDocument()
  })
})
