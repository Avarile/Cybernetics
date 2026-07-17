"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  useAIChatStore,
  useAIActiveAgent,
  useAIActiveThread,
  useAIThreads,
} from "@/lib/ai-chat-modal/ai-chat"
import type { IThread } from "@/lib/interfaces/mastra.interface"
import {
  TERMINAL_COMMANDS,
  type CommandId,
  type TerminalCommandDef,
} from "@/components/ai-elements/code/terminal-command-palette"
import { type TerminalLine, errorLine } from "./terminal-types"

export function useTerminalPalette(appendLine: (line: TerminalLine) => void) {
  const { sendMessage, startNewThread, loadThread, resetConversation } = useAIChatStore()
  const activeThread = useAIActiveThread()
  const activeAgentId = useAIActiveAgent()
  const threads = useAIThreads()
  const firstAgentId = useAIChatStore((s) => Object.keys(s.agents)[0] ?? null)
  const isLoadingThreads = useAIChatStore((s) => s.isLoadingThreads)

  const inputRef = useRef<HTMLInputElement>(null)
  const [inputValue, setInputValue] = useState("")
  const [paletteMode, setPaletteMode] = useState<"commands" | "sessions">("commands")
  const [paletteSelectedIndex, setPaletteSelectedIndex] = useState(0)

  const paletteOpen = inputValue.startsWith("/")
  const paletteQuery = paletteOpen ? inputValue.slice(1) : ""
  const filteredCommands: TerminalCommandDef[] = TERMINAL_COMMANDS.filter(
    (c) => !paletteQuery || c.id.toLowerCase().includes(`/${paletteQuery.toLowerCase()}`),
  )
  const paletteItemCount =
    paletteMode === "commands" ? filteredCommands.length : threads.length

  // Reset selection when query or mode changes
  useEffect(() => {
    setPaletteSelectedIndex(0)
  }, [paletteQuery, paletteMode])

  const dispatchMessage = useCallback(
    (text: string) => {
      const agentId = activeAgentId ?? firstAgentId
      if (!agentId) {
        appendLine(errorLine("No agent available. Try again in a moment."))
        return
      }
      if (activeThread) {
        sendMessage(text)
      } else {
        startNewThread(agentId, text)
      }
    },
    [activeAgentId, firstAgentId, activeThread, sendMessage, startNewThread, appendLine],
  )

  const closePalette = useCallback(() => {
    setInputValue("")
    setPaletteMode("commands")
    setPaletteSelectedIndex(0)
  }, [])

  const handleCommandSelect = useCallback(
    (id: CommandId) => {
      if (id === "/sessions") {
        setPaletteMode("sessions")
        setPaletteSelectedIndex(0)
        setInputValue("/sessions")
        return
      }
      closePalette()
      if (id === "/clear") {
        resetConversation()
        return
      }
      if (id === "/skills") {
        dispatchMessage(
          "List all the skills you currently have available. For each skill, provide its name and a brief description of what it does. Format as a clean list.",
        )
        return
      }
      if (id === "/sub-agents") {
        dispatchMessage(
          "List all the sub-agents you currently have available for delegation. For each agent, provide its name and the tasks or domains it specialises in. Format as a clean list.",
        )
        return
      }
    },
    [closePalette, resetConversation, dispatchMessage],
  )

  const handleThreadSelect = useCallback(
    (thread: IThread) => {
      const agentId = thread.agentId ?? activeAgentId ?? firstAgentId
      if (!agentId) return
      loadThread(agentId, thread.id)
      closePalette()
    },
    [loadThread, activeAgentId, firstAgentId, closePalette],
  )

  const handleSubmit = useCallback(() => {
    const text = inputValue.trim()
    if (!text) return
    setInputValue("")
    dispatchMessage(text)
  }, [inputValue, dispatchMessage])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (paletteOpen) {
        if (e.key === "ArrowUp") {
          e.preventDefault()
          setPaletteSelectedIndex((i) => Math.max(0, i - 1))
          return
        }
        if (e.key === "ArrowDown") {
          e.preventDefault()
          setPaletteSelectedIndex((i) => Math.min(paletteItemCount - 1, i + 1))
          return
        }
        if (e.key === "Escape") {
          e.preventDefault()
          if (paletteMode === "sessions") {
            setPaletteMode("commands")
            setInputValue("/")
          } else {
            closePalette()
          }
          return
        }
        if (e.key === "Enter") {
          e.preventDefault()
          if (paletteMode === "commands" && filteredCommands[paletteSelectedIndex]) {
            handleCommandSelect(filteredCommands[paletteSelectedIndex].id)
          } else if (paletteMode === "sessions" && threads[paletteSelectedIndex]) {
            handleThreadSelect(threads[paletteSelectedIndex])
          }
          return
        }
        return
      }
      if (e.key === "Enter") {
        e.preventDefault()
        handleSubmit()
      }
    },
    [
      paletteOpen,
      paletteMode,
      paletteItemCount,
      paletteSelectedIndex,
      filteredCommands,
      threads,
      handleCommandSelect,
      handleThreadSelect,
      handleSubmit,
      closePalette,
    ],
  )

  const canChat = !!(activeAgentId ?? firstAgentId)
  const activeThreadId = activeThread?.id ?? null
  const activeThreadTitle = activeThread?.title ?? null

  return {
    inputRef,
    inputValue,
    setInputValue,
    paletteOpen,
    paletteMode,
    paletteSelectedIndex,
    paletteQuery,
    filteredCommands,
    closePalette,
    dispatchMessage,
    handleCommandSelect,
    handleThreadSelect,
    handleKeyDown,
    threads,
    isLoadingThreads,
    canChat,
    activeThreadId,
    activeThreadTitle,
  }
}
