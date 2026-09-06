"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useForgotPassword } from "@/features/session/use-forgot-password"

export function ForgotPane({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("")
  // Always confirms, whether or not the address exists — the hook owns that
  // reasoning, and the copy below is written to match it.
  const { sent, pending, request } = useForgotPassword()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    await request(email)
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          If an account exists for {email}, a reset code is on its way.
        </p>
        <Button variant="outline" onClick={onBack}>
          Back to sign in
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="forgot-email">Email</FieldLabel>
          <Input
            id="forgot-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Sending…" : "Send reset code"}
          </Button>
        </Field>
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={onBack}
          className="justify-start px-0"
        >
          Back to sign in
        </Button>
      </FieldGroup>
    </form>
  )
}
