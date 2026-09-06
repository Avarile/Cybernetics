"use client"

import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning"
import { MessageResponse } from "@/components/ai-elements/message"
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolPart,
} from "@/components/ai-elements/tool"
import type { ChatMessagePart } from "@/lib/agent/types"

/**
 * Renders one message's parts.
 *
 * Deliberately shared by stored history and the in-flight turn: a replayed
 * conversation and a live one go through this same component, so the two are
 * indistinguishable on screen. That is only possible because the reducer emits
 * the same `ChatMessagePart` shape the history endpoint returns.
 */
export function MessageParts({
  parts,
  streaming,
}: {
  parts: ChatMessagePart[]
  /** The last reasoning block auto-expands while it is the live one. */
  streaming?: boolean
}) {
  return (
    <>
      {parts.map((part, i) => {
        const key = `${part.type}-${i}`

        if (part.type === "text") {
          return <MessageResponse key={key}>{part.text}</MessageResponse>
        }

        if (part.type === "reasoning") {
          const isLast = i === parts.length - 1
          return (
            <Reasoning key={key} isStreaming={Boolean(streaming) && isLast}>
              <ReasoningTrigger />
              <ReasoningContent>{part.text}</ReasoningContent>
            </Reasoning>
          )
        }

        if (part.type === "tool") {
          return (
            <Tool key={key}>
              <ToolHeader
                type="dynamic-tool"
                toolName={part.toolName}
                state={part.state as ToolPart["state"]}
              />
              <ToolContent>
                <ToolInput input={part.input} />
                <ToolOutput
                  errorText={part.errorText}
                  output={part.output as never}
                />
              </ToolContent>
            </Tool>
          )
        }

        if (part.type === "source") {
          return (
            <a
              key={key}
              href={part.url}
              target="_blank"
              rel="noreferrer"
              className="block text-xs text-muted-foreground underline underline-offset-2"
            >
              {part.title ?? part.url ?? part.sourceId}
            </a>
          )
        }

        return null
      })}
    </>
  )
}
