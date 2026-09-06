import { describe, expect, it } from "vitest"
import { cn } from "@/lib/utils"

describe("test harness", () => {
  it("resolves the @/ alias", () => {
    expect(cn("a", "b")).toContain("a")
  })

  it("provides a DOM", () => {
    const main = document.createElement("main")
    main.id = "x"
    main.textContent = "ok"
    document.body.appendChild(main)
    expect(document.getElementById("x")?.textContent).toBe("ok")
  })
})
