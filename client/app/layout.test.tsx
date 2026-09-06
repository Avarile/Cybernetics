import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useSessionStore } from "@/stores/session.store"
import { useWorkspaceStore } from "@/stores/workspace.store"

// next/font/google needs the Next.js build-time compiler to resolve; calling
// it directly under vitest throws. The mock only stands in for the font
// loading, not for anything under test here.
vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "font-sans-mock" }),
  Geist_Mono: () => ({ variable: "font-mono-mock" }),
}))

// Spies on the prop StateProvider actually receives, so this test fails if
// layout.tsx ever goes back to rendering <StateProvider> directly (no
// onAuthFailure reaches it) or if <Providers> stops forwarding the callback —
// not just if resetClientState itself breaks.
const stateProviderSpy = vi.fn()
vi.mock("@/lib/swr/provider", () => ({
  StateProvider: (props: { children: React.ReactNode }) => {
    stateProviderSpy(props)
    return props.children
  },
}))

import RootLayout from "./layout"

describe("RootLayout", () => {
  it("wires resetClientState into StateProvider's onAuthFailure", () => {
    render(<RootLayout>{<div>hi</div>}</RootLayout>)

    expect(stateProviderSpy).toHaveBeenCalledTimes(1)
    const { onAuthFailure } = stateProviderSpy.mock.calls[0][0] as {
      onAuthFailure?: (mutate: unknown) => void
    }
    expect(typeof onAuthFailure).toBe("function")

    // Design §5.3: the real point of this wiring is that a refresh failure
    // tears down the workspace, not just that some callback exists. Prove it
    // by exercising the callback we captured and checking real store state —
    // a stub that does nothing would satisfy "is a function" but fail this.
    useSessionStore.getState().setTokens({ accessToken: "a", refreshToken: "r", expiresIn: 60 })
    useWorkspaceStore.getState().openWindow({ kind: "contacts" })

    onAuthFailure!(null)

    expect(useSessionStore.getState().accessToken).toBeNull()
    expect(useWorkspaceStore.getState().windows).toHaveLength(0)
  })
})
