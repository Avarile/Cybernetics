import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useAuthWindow } from "@/components/shell/use-auth-window"
import { ApiProvider } from "@/lib/api/provider"
import { useAuthStore } from "@/stores/auth.store"
import { useWorkspaceStore } from "@/stores/workspace.store"
import { AuthWindow } from "./auth-window"

const fetchImpl = vi.fn()

function renderAuth() {
  return render(
    <ApiProvider baseUrl="https://api.test" fetchImpl={fetchImpl as unknown as typeof fetch}>
      <AuthWindow />
    </ApiProvider>,
  )
}

/**
 * The window-managed dialog, rather than the bare form: `useAuthWindow` is what
 * ties the auth store back to the window store, so only this arrangement can
 * catch a login that signs the user in but leaves the modal on screen.
 */
function Gate() {
  useAuthWindow()
  return <AuthWindow />
}

function renderGate() {
  return render(
    <ApiProvider baseUrl="https://api.test" fetchImpl={fetchImpl as unknown as typeof fetch}>
      <Gate />
    </ApiProvider>,
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
    vi.clearAllMocks()
    localStorage.clear()
    useAuthStore.getState().clear()
    useWorkspaceStore.getState().closeAll()
  })

  it("shows the sign-in form by default", () => {
    renderAuth()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument()
  })

  it("signs in and stores the principal", async () => {
    fetchImpl
      .mockResolvedValueOnce(json({ accessToken: "a-1", refreshToken: "r-1", expiresIn: 900 }))
      .mockResolvedValueOnce(json({ id: "u1", kind: "user", role: "admin", email: "a@b.c" }))

    renderAuth()
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.c")
    await userEvent.type(screen.getByLabelText(/password/i), "pw")
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }))

    await waitFor(() => {
      expect(useAuthStore.getState().principal?.email).toBe("a@b.c")
    })
    expect(useAuthStore.getState().accessToken).toBe("a-1")
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
    expect(useAuthStore.getState().principal).toBeNull()
  })

  it("leaves no half-session behind when /auth/me fails after a good login", async () => {
    fetchImpl
      .mockResolvedValueOnce(json({ accessToken: "a-1", refreshToken: "r-1", expiresIn: 900 }))
      .mockResolvedValueOnce(json({ error: { code: "UNKNOWN", message: "boom", statusCode: 500 } }, 500))

    renderAuth()
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.c")
    await userEvent.type(screen.getByLabelText(/password/i), "pw")
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }))

    await screen.findByRole("alert")
    const s = useAuthStore.getState()
    expect(s.accessToken).toBeNull()
    expect(s.principal).toBeNull()
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
      .mockResolvedValueOnce(json({ id: "u1", kind: "user", role: "admin", email: "a@b.c" }))

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
      .mockResolvedValueOnce(json({ error: { code: "UNKNOWN", message: "boom", statusCode: 500 } }, 500))

    renderGate()
    await submitCredentials("pw")

    await screen.findByRole("alert")
    expect(authWindows()).toHaveLength(1)
  })
})
