import { nanoid } from "nanoid"
import type { IChatMessage, ICitationSource, IUIHint } from "@/lib/interfaces/mastra.interface"

export type LineType = "input" | "output" | "system" | "error"

export interface TerminalLine {
  id: string
  type: LineType
  text: string
  ui?: IUIHint[]
  sources?: ICitationSource[]
}

export function msgToLine(m: IChatMessage): TerminalLine {
  return {
    id: m.id,
    type: m.role === "user" ? "input" : "output",
    text: m.content,
    ui: m.role === "assistant" ? m.ui : undefined,
    sources: m.role === "assistant" ? m.sources : undefined,
  }
}

export function systemLine(text: string): TerminalLine {
  return { id: nanoid(), type: "system", text }
}

export function errorLine(text: string): TerminalLine {
  return { id: nanoid(), type: "error", text }
}
