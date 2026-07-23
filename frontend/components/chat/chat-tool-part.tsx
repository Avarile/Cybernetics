'use client'
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/code/tool'
import type { ChatPart, ChatToolState } from '@/lib/interfaces/chat.interface'

/** Backend history carries Mastra/v4 states ('call'/'result'/'partial-call'); live SSE uses v5.
 *  Normalize both to the AI Elements ToolHeader union. */
export function normalizeToolState(state: string): ChatToolState {
  switch (state) {
    case 'call': return 'input-available'
    case 'partial-call': return 'input-streaming'
    case 'result': return 'output-available'
    case 'input-streaming':
    case 'input-available':
    case 'approval-requested':
    case 'approval-responded':
    case 'output-available':
    case 'output-denied':
    case 'output-error':
      return state
    default: return 'output-available'
  }
}

export function ChatToolPart({ part }: { part: Extract<ChatPart, { type: 'tool' }> }) {
  const state = normalizeToolState(part.state)
  return (
    <Tool>
      <ToolHeader type="dynamic-tool" state={state} toolName={part.toolName || 'tool'} />
      <ToolContent>
        {part.input !== undefined && <ToolInput input={part.input} />}
        {(part.output !== undefined || part.errorText) && (
          <ToolOutput output={part.output as never} errorText={part.errorText} />
        )}
      </ToolContent>
    </Tool>
  )
}
