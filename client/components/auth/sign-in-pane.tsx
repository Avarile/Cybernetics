"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useSignIn } from "@/features/session/use-sign-in"

export function SignInPane({ onForgot }: { onForgot: () => void }) {
  const { signIn, pending, error } = useSignIn()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    await signIn(email, password)
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
            placeholder="m@example.com"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field>
          <div className="flex items-center">
            <FieldLabel htmlFor="password">Password</FieldLabel>
            {/* A button, not the reference's `<a href="#">`: this switches
                panes in place, and there is no page to navigate to. */}
            <Button
              type="button"
              variant="link"
              onClick={onForgot}
              className="ml-auto h-auto w-auto p-0 text-sm font-normal underline-offset-4 hover:underline"
            >
              Forgot your password?
            </Button>
          </div>
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
      </FieldGroup>
    </form>
  )
}
