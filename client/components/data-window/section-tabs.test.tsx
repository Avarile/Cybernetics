import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { SectionTabs } from "./section-tabs"
import type { SectionSpec } from "./types"

const body = { kind: "custom" as const, render: () => null }

const SECTIONS: SectionSpec[] = [
  { key: "transactions", label: "Transactions", body },
  { key: "invoices", label: "Invoices", body },
  { key: "categories", label: "Categories", secondary: true, body },
  { key: "fx", label: "FX rates", secondary: true, body },
]

function tree(props: Partial<React.ComponentProps<typeof SectionTabs>> = {}) {
  return (
    <SectionTabs sections={SECTIONS} active="transactions" onSelect={() => {}} {...props} />
  )
}

describe("SectionTabs", () => {
  it("renders primary sections as tabs and keeps secondary ones out of the row", () => {
    render(tree())
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Transactions",
      "Invoices",
    ])
  })

  it("lists exactly the secondary sections in the overflow menu", async () => {
    render(tree())
    await userEvent.click(screen.getByRole("button", { name: "More sections" }))

    expect(screen.getByRole("menuitemcheckbox", { name: "Categories" })).toBeInTheDocument()
    expect(screen.getByRole("menuitemcheckbox", { name: "FX rates" })).toBeInTheDocument()
    expect(screen.queryByRole("menuitemcheckbox", { name: "Invoices" })).not.toBeInTheDocument()
  })

  it("selects from the overflow menu", async () => {
    const onSelect = vi.fn()
    render(tree({ onSelect }))

    await userEvent.click(screen.getByRole("button", { name: "More sections" }))
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "FX rates" }))

    expect(onSelect).toHaveBeenCalledWith("fx")
  })

  it("promotes an active secondary section into the tab row", () => {
    // Otherwise the row shows no selection at all and the user cannot see
    // where they are.
    render(tree({ active: "fx" }))
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent)
    expect(tabs).toContain("FX rates")
    expect(screen.getByRole("tab", { name: "FX rates" })).toHaveAttribute("data-state", "active")
  })

  it("renders no overflow trigger when there are no secondary sections", () => {
    render(tree({ sections: SECTIONS.filter((s) => !s.secondary) }))
    expect(screen.queryByRole("button", { name: "More sections" })).not.toBeInTheDocument()
  })

  it("renders nothing at all for a single-section domain", () => {
    // One section is not a choice; a tab row of one is chrome with no function.
    const { container } = render(tree({ sections: [SECTIONS[0]], active: "transactions" }))
    expect(container).toBeEmptyDOMElement()
  })
})
