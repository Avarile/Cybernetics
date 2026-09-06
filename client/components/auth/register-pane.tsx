"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PASSWORD_MIN_LENGTH } from "@/lib/api/types"
import { useSignIn } from "@/features/session/use-sign-in"

/**
 * Gated behind NEXT_PUBLIC_ENABLE_REGISTER because `POST /auth/register` does
 * not exist: `users.controller.ts` is admin-only provisioning ("no public
 * signup"). The request below is the contract recorded in the design doc §5.2,
 * so the backend task has a spec to build against.
 */
export function RegisterPane() {
  const { register, pending, error } = useSignIn()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [displayName, setDisplayName] = useState("")

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    await register({ email, password, displayName })
  }

  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="reg-name">Name</FieldLabel>
          <Input id="reg-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="reg-email">Email</FieldLabel>
          <Input
            id="reg-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="reg-password">Password</FieldLabel>
          <Input
            id="reg-password"
            type="password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <FieldDescription>At least {PASSWORD_MIN_LENGTH} characters.</FieldDescription>
        </Field>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create account"}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}
