import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { SSE_EVENT_TYPES } from "./types"

/**
 * The client hand-mirrors the backend's SseEvent union rather than importing
 * it. This is what keeps the copy honest: it reads the real source and fails
 * when the two drift.
 *
 * Skips (rather than fails) when api/ is not checked out beside client/, so the
 * frontend can still be built standalone.
 */
const SOURCE = join(
  process.cwd(),
  "..",
  "api",
  "src",
  "features",
  "mastra",
  "services",
  "chunk-to-sse.ts",
)

const source = (() => {
  try {
    return readFileSync(SOURCE, "utf8")
  } catch {
    return null
  }
})()

/** Pulls the `type: 'x'` literals out of the exported SseEvent union. */
function backendEventTypes(text: string): string[] {
  const start = text.indexOf("export type SseEvent")
  expect(start).toBeGreaterThanOrEqual(0)
  // The union ends at the first line that closes it with a semicolon.
  const end = text.indexOf("\n\n", start)
  const block = text.slice(start, end === -1 ? undefined : end)
  return [...block.matchAll(/type:\s*'([a-z-]+)'/g)].map((m) => m[1])
}

describe.skipIf(source === null)("SseEvent contract", () => {
  it("mirrors every variant the backend emits, and no extras", () => {
    const backend = backendEventTypes(source as string)
    expect(backend.length).toBeGreaterThan(0)
    expect([...backend].sort()).toEqual([...SSE_EVENT_TYPES].sort())
  })

  it("mirrors the terminal statuses a done frame can carry", () => {
    const text = source as string
    const doneLine = text.slice(text.indexOf("type: 'done'"))
    const statuses = [...doneLine.slice(0, 200).matchAll(/'([a-z_]+)'/g)]
      .map((m) => m[1])
      .filter((s) => s !== "done")
    expect(statuses.sort()).toEqual(
      ["awaiting_approval", "cancelled", "failed", "succeeded"].sort(),
    )
  })

  it("still writes frames as `data: {json}\\n\\n`", () => {
    // The parser's framing assumption. If sseFrame changes shape, SseParser
    // must change with it.
    expect(source as string).toContain("return `data: ${JSON.stringify(event)}\\n\\n`")
  })
})
