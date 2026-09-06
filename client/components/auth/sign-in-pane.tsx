"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ApiError } from "@/lib/api/errors"
import { useApi } from "@/lib/api/provider"
import { useAuthStore } from "@/stores/auth.store"

export function SignInPane({ onForgot }: { onForgot: () => void }) {
  const { auth } = useApi()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      const pair = await auth.login({ email, password })
      useAuthStore.getState().setTokens(pair)
      const principal = await auth.me()
      useAuthStore.getState().setPrincipal(principal)
    } catch (err) {
      // Clear rather than leave half a session behind: login may have succeeded
      // and /auth/me failed, which would otherwise leave tokens with no principal.
      useAuthStore.getState().clear()
      setError(err instanceof ApiError ? err.message : "Could not sign in")
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </Field>

        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={onForgot}
          className="justify-start px-0"
        >
          Forgot your password?
        </Button>
      </FieldGroup>
    </form>
  )
}
