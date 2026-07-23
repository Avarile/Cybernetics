'use client'
import type { ChatStatus } from 'ai'
import { PromptInput, PromptInputSubmit, PromptInputTextarea } from '@/components/ai-elements/chatbot/prompt-input'

interface Props {
  status: ChatStatus
  onSend: (text: string) => void
  onStop?: () => void
}

export function ChatComposer({ status, onSend, onStop }: Props) {
  return (
    <PromptInput
      className="mx-auto w-full max-w-3xl"
      onSubmit={(message) => {
        if (message.text.trim()) onSend(message.text)
      }}
    >
      <PromptInputTextarea placeholder="Message the assistant…" />
      <PromptInputSubmit status={status} onStop={onStop} />
    </PromptInput>
  )
}
