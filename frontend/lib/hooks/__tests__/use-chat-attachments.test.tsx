import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const uploadAll = vi.fn().mockResolvedValue(['f1'])
const reset = vi.fn()
vi.mock('@/lib/hooks/use-file-upload', () => ({
  useFileUpload: () => ({ items: [], uploadAll, reset }),
}))
import { useChatAttachments } from '@/lib/hooks/use-chat-attachments'

const file = (name: string, type = 'application/pdf') => new File(['x'], name, { type })
beforeEach(() => vi.clearAllMocks())

describe('useChatAttachments', () => {
  it('uploads only ingestable docs, tagging conversationId', async () => {
    const { result } = renderHook(() => useChatAttachments('c1'))
    await act(async () => { await result.current.addFiles([file('a.pdf'), file('b.png', 'image/png')]) })
    expect(uploadAll).toHaveBeenCalledWith([expect.objectContaining({ name: 'a.pdf' })], { conversationId: 'c1' })
    expect(result.current.rejectedCount).toBe(1)
  })
  it('omits conversationId metadata for a new chat (null id)', async () => {
    const { result } = renderHook(() => useChatAttachments(null))
    await act(async () => { await result.current.addFiles([file('a.pdf')]) })
    expect(uploadAll).toHaveBeenCalledWith([expect.objectContaining({ name: 'a.pdf' })], undefined)
  })
})
