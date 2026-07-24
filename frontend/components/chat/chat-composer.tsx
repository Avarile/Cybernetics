'use client'
import * as React from 'react'
import type { ChatStatus } from 'ai'
import { HugeiconsIcon } from '@hugeicons/react'
import { Attachment01Icon } from '@hugeicons/core-free-icons'
import { PromptInput, PromptInputSubmit, PromptInputTextarea } from '@/components/ai-elements/chatbot/prompt-input'
import { Button } from '@/components/ui/button'
import { FileUploadList } from '@/app/dashboard/file-management/components/file-upload-list'
import { useChatAttachments } from '@/lib/hooks/use-chat-attachments'
import { DOC_ACCEPT } from '@/lib/upload/ingestable-docs'

interface Props {
  status: ChatStatus
  onSend: (text: string) => void
  onStop?: () => void
  conversationId?: string | null
}

export function ChatComposer({ status, onSend, onStop, conversationId = null }: Props) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const { items, addFiles, reset, rejectedCount } = useChatAttachments(conversationId)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
      {items.length > 0 && (
        <div className="rounded-md border p-2">
          <FileUploadList items={items} />
        </div>
      )}
      {rejectedCount > 0 && (
        <p className="px-1 text-xs text-muted-foreground">{rejectedCount} unsupported file(s) skipped — only PDF, DOCX, MD, TXT.</p>
      )}
      {/* Rendered before PromptInput so it is the first `input[type=file]` in the DOM —
          PromptInput mounts its own (unused) hidden file input internally. */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={DOC_ACCEPT}
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void addFiles(Array.from(e.target.files))
          e.target.value = ''
        }}
      />
      <PromptInput
        onSubmit={(message) => {
          if (message.text.trim()) {
            onSend(message.text)
            reset()
          }
        }}
      >
        <PromptInputTextarea placeholder="Message the assistant…" />
        <div className="flex items-center justify-between px-1 pb-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Attach documents"
            onClick={() => inputRef.current?.click()}
          >
            <HugeiconsIcon icon={Attachment01Icon} strokeWidth={2} className="size-4" />
          </Button>
          <PromptInputSubmit status={status} onStop={onStop} />
        </div>
      </PromptInput>
    </div>
  )
}
