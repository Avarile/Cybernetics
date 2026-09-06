"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useApi } from "@/lib/api/provider"

export function ForgotPane({ onBack }: { onBack: () => void }) {
  const { auth } = useApi()
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [pending, setPending] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    // The endpoint answers identically for known and unknown addresses, so
    // there is nothing to branch on — and nothing to leak by always confirming.
    try {
      await auth.forgotPassword(email)
    } catch {
      // deliberately swallowed: see above
    } finally {
      setSent(true)
      setPending(false)
    }
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
          <FieldDescription>We&apos;ll send a reset code to this address.</FieldDescription>
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
