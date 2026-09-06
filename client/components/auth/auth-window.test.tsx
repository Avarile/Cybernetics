import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useAuthGate } from "@/features/session/use-auth-gate"
import { useSession } from "@/features/session/use-session"
import { StateProvider } from "@/lib/swr/provider"
import { useSessionStore } from "@/stores/session.store"
import { useWorkspaceStore } from "@/stores/workspace.store"
import { SWRConfig } from "swr"
import { AuthWindow } from "./auth-window"

const fetchImpl = vi.fn()

/**
 * Surfaces the session SWR reads a bare `render()` has no other way to reach:
 * the principal moved out of the zustand store and into the SWR cache with
 * Task 13, so a test can no longer read `useSessionStore.getState().principal`.
 */
function Probe() {
  const { principal, authed } = useSession()
  return (
    <div>
      <span data-testid="principal-email">{principal?.email ?? "none"}</span>
      <span data-testid="authed">{String(authed)}</span>
    </div>
  )
}

// A fresh Map per render: the default SWR cache is a module-level singleton,
// and it would otherwise leak session reads between test cases.
//
// `revalidateOnMount: false`: without it, activating the session key for the
// first time (null -> ["session"], on sign-in) can itself kick off SWR's own
// background revalidation against the same persistent `fetchImpl` mock,
// independently of `useSignIn`'s explicit cache seed — which would mask that
// seed being deleted entirely. These tests are about `useSignIn`'s own
// behaviour, not SWR's incidental auto-fetch.
function renderAuth() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), revalidateOnMount: false }}>
      <StateProvider baseUrl="https://api.test" fetchImpl={fetchImpl as unknown as typeof fetch}>
        <AuthWindow />
        <Probe />
      </StateProvider>
    </SWRConfig>,
  )
}

/**
 * The window-managed dialog, rather than the bare form: `useAuthGate` is what
 * ties the session back to the window store, so only this arrangement can
 * catch a login that signs the user in but leaves the modal on screen.
 *
 * `true` stands in for `hydrated`: this suite is not exercising the
 * hydration/bootstrap ordering (that lives in use-auth-gate.test.tsx and
 * state-hydration.test.tsx), so hydration is treated as already settled.
 */
function Gate() {
  useAuthGate(true)
  return <AuthWindow />
}

function renderGate() {
  return render(
    // `revalidateOnMount: false`: see the note on `renderAuth` above — the
    // gate closing must be driven by `useSignIn`'s explicit seed, not an
    // incidental SWR auto-fetch that happens to hit the same mock.
    <SWRConfig value={{ provider: () => new Map(), revalidateOnMount: false }}>
      <StateProvider baseUrl="https://api.test" fetchImpl={fetchImpl as unknown as typeof fetch}>
        <Gate />
      </StateProvider>
    </SWRConfig>,
  )
}

function authWindows() {
  return useWorkspaceStore.getState().windows.filter((w) => w.kind === "auth")
}

async function submitCredentials(password: string) {
  await userEvent.type(screen.getByLabelText(/email/i), "a@b.c")
  await userEvent.type(screen.getByLabelText(/password/i), password)
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }))
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("AuthWindow", () => {
  beforeEach(() => {
    // `mockReset`, not `clearAllMocks`: `clearAllMocks` only clears call
    // history, not a queued `mockResolvedValueOnce`/`mockImplementation` —
    // which would otherwise leak from one test's fetchImpl setup into the
    // next test's calls.
    fetchImpl.mockReset()
    localStorage.clear()
    useSessionStore.getState().clear()
    useWorkspaceStore.getState().closeAll()
  })

  it("shows the sign-in form by default", () => {
    renderAuth()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument()
  })

  it("signs in and stores the principal", async () => {
    // Consumed exactly once each: `revalidateOnMount: false` on `renderAuth`
    // means the second response can only ever be read by useSignIn's own
    // explicit `auth.me()` call, not an incidental SWR auto-fetch.
    fetchImpl
      .mockResolvedValueOnce(json({ accessToken: "a-1", refreshToken: "r-1", expiresIn: 900 }))
      .mockResolvedValueOnce(json({ id: "u1", kind: "user", role: "admin", email: "a@b.c" }))

    renderAuth()
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.c")
    await userEvent.type(screen.getByLabelText(/password/i), "pw")
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }))

    // `useSignIn`'s `mutate(keys.session(), await auth.me(), {revalidate:
    // false})` is the ONLY thing that can have populated this: SWR's own
    // auto-revalidation is off, so nothing else could have filled the cache.
    expect(screen.getByTestId("principal-email")).toHaveTextContent("a@b.c")
    expect(useSessionStore.getState().accessToken).toBe("a-1")
  })

  it("shows the API's message when credentials are rejected", async () => {
    fetchImpl.mockResolvedValueOnce(
      json(
        {
          error: {
            code: "AUTH_INVALID_CREDENTIALS",
            message: "Invalid email or password",
            statusCode: 401,
            details: null,
            correlationId: "c",
            timestamp: "t",
            path: "/auth/login",
          },
        },
        401,
      ),
    )

    renderAuth()
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.c")
    await userEvent.type(screen.getByLabelText(/password/i), "wrong")
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password")
    expect(screen.getByTestId("principal-email")).toHaveTextContent("none")
  })

  it("leaves no half-session behind when /auth/me fails after a good login", async () => {
    fetchImpl
      .mockResolvedValueOnce(json({ accessToken: "a-1", refreshToken: "r-1", expiresIn: 900 }))
      // `mockImplementation`, not `mockResolvedValue`: a `Response` body can
      // only be read once, and reusing the SAME instance across more than
      // one call throws "Body is unusable" on the second read.
      .mockImplementation(() => json({ error: { code: "UNKNOWN", message: "boom", statusCode: 500 } }, 500))

    renderAuth()
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.c")
    await userEvent.type(screen.getByLabelText(/password/i), "pw")
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }))

    await screen.findByRole("alert")
    expect(useSessionStore.getState().accessToken).toBeNull()
    expect(screen.getByTestId("principal-email")).toHaveTextContent("none")
  })

  it("hides Register and explains why when the flag is off", () => {
    renderAuth()
    expect(screen.queryByRole("tab", { name: /register/i })).not.toBeInTheDocument()
    expect(screen.getByText(/provisioned by an administrator/i)).toBeInTheDocument()
  })

  it("switches to the forgot-password pane", async () => {
    renderAuth()
    await userEvent.click(screen.getByRole("button", { name: /forgot your password/i }))
    expect(screen.getByRole("button", { name: /send reset code/i })).toBeInTheDocument()
  })

  it("dismisses itself once the sign-in succeeds", async () => {
    fetchImpl
      .mockResolvedValueOnce(json({ accessToken: "a-1", refreshToken: "r-1", expiresIn: 900 }))
      // `mockImplementation`, not `mockResolvedValue`: see the note above.
      .mockImplementation(() => json({ id: "u1", kind: "user", role: "admin", email: "a@b.c" }))

    renderGate()
    expect(authWindows()).toHaveLength(1)

    await submitCredentials("pw")

    // The reported bug: the dialog and its click-swallowing scrim stayed put
    // until the user reloaded the page.
    await waitFor(() => expect(authWindows()).toHaveLength(0))
  })

  it("stays open when the credentials are rejected", async () => {
    fetchImpl.mockResolvedValueOnce(
      json({ error: { code: "AUTH_INVALID_CREDENTIALS", message: "Nope", statusCode: 401 } }, 401),
    )

    renderGate()
    await submitCredentials("wrong")

    await screen.findByRole("alert")
    expect(authWindows()).toHaveLength(1)
  })

  it("stays open when /auth/me fails after a good login", async () => {
    fetchImpl
      .mockResolvedValueOnce(json({ accessToken: "a-1", refreshToken: "r-1", expiresIn: 900 }))
      // `mockImplementation`, not `mockResolvedValue`: see the note above.
      .mockImplementation(() => json({ error: { code: "UNKNOWN", message: "boom", statusCode: 500 } }, 500))

    renderGate()
    await submitCredentials("pw")

    await screen.findByRole("alert")
    expect(authWindows()).toHaveLength(1)
  })
})
