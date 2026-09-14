import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { BookOpenIcon, UsersIcon } from "lucide-react"
import { SidebarProvider } from "@/components/ui/sidebar"
import { DomainNav } from "./domain-nav"
import type { DomainSpec } from "./types"

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }))

const section = { key: "a", label: "A", body: { kind: "custom" as const, render: () => null } }

const DOMAINS: DomainSpec[] = [
  { key: "contacts", label: "Contacts", icon: UsersIcon, sections: [section] },
  { key: "knowledge", label: "Knowledge", icon: BookOpenIcon, sections: [section] },
]

function tree(props: Partial<React.ComponentProps<typeof DomainNav>> = {}) {
  return (
    <SidebarProvider>
      <DomainNav domains={DOMAINS} active="contacts" onSelect={() => {}} {...props} />
    </SidebarProvider>
  )
}

describe("DomainNav", () => {
  it("renders one button per domain, in registry order", () => {
    render(tree())
    const names = screen.getAllByRole("button").map((b) => b.textContent)
    expect(names).toEqual(["Contacts", "Knowledge"])
  })

  it("calls onSelect with the domain key", async () => {
    const onSelect = vi.fn()
    render(tree({ onSelect }))

    await userEvent.click(screen.getByRole("button", { name: "Knowledge" }))

    expect(onSelect).toHaveBeenCalledWith("knowledge")
  })

  it("marks the active domain with aria-current", () => {
    render(tree({ active: "knowledge" }))
    expect(screen.getByRole("button", { name: "Knowledge" })).toHaveAttribute(
      "aria-current",
      "page",
    )
    expect(screen.getByRole("button", { name: "Contacts" })).not.toHaveAttribute("aria-current")
  })
})
