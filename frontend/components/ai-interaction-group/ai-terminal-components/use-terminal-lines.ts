"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  useAIChatStore,
  useAIActiveThread,
  useAIMessages,
  useAIIsSending,
  useAIError,
} from "@/lib/ai-chat-modal/ai-chat"
import { type TerminalLine, msgToLine, systemLine, errorLine } from "./terminal-types"

export function useTerminalLines() {
  const { fetchAgents, fetchThreads, clearError } = useAIChatStore()
  const activeThread = useAIActiveThread()
  const messages = useAIMessages()
  const isSending = useAIIsSending()
  const error = useAIError()

  const [lines, setLines] = useState<TerminalLine[]>([
    systemLine("AI Terminal ready. Type / for commands."),
  ])

  const outputRef = useRef<HTMLDivElement>(null)
  const seenMessageIds = useRef(new Set<string>())
  const prevThreadIdRef = useRef<string | null>(null)

  // Init: load agents and threads once
  useEffect(() => {
    fetchAgents()
    fetchThreads()
  }, [fetchAgents, fetchThreads])

  // Message sync: thread switch (full re-render) vs incremental append
  useEffect(() => {
    const prevThreadId = prevThreadIdRef.current
    const currentThreadId = activeThread?.id ?? null
    prevThreadIdRef.current = currentThreadId

    const isThreadSwitch = currentThreadId !== prevThreadId

    if (isThreadSwitch) {
      seenMessageIds.current = new Set()
      const additions: TerminalLine[] = []

      if (currentThreadId) {
        additions.push(systemLine(`─── ${activeThread?.title ?? "Untitled"} ───`))
      } else if (prevThreadId !== null) {
        additions.push(systemLine("─── session cleared ───"))
      }

      messages.forEach((m) => {
        additions.push(msgToLine(m))
        seenMessageIds.current.add(m.id)
      })

      if (additions.length > 0) {
        setLines((prev) => [...prev, ...additions])
      }
      return
    }

    const newMsgs = messages.filter((m) => !seenMessageIds.current.has(m.id))
    if (newMsgs.length === 0) return
    newMsgs.forEach((m) => seenMessageIds.current.add(m.id))
    setLines((prev) => [...prev, ...newMsgs.map(msgToLine)])
  }, [messages, activeThread])

  // Error sync: push error line then clear store error
  useEffect(() => {
    if (error) {
      setLines((prev) => [...prev, errorLine(error)])
      clearError()
    }
  }, [error, clearError])

  // Auto-scroll to bottom whenever lines or sending state changes
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [lines, isSending])

  const appendLine = useCallback((line: TerminalLine) => {
    setLines((prev) => [...prev, line])
  }, [])

  const clearOutput = useCallback(() => {
    setLines([systemLine("Terminal cleared.")])
  }, [])

  return { lines, outputRef, appendLine, clearOutput, isSending }
}
