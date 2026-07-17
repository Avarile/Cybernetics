'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { IconLayoutRows } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/lib/state-management/auth.store'

export default function ResendVerificationPage() {
  const resendVerification = useAuthStore((s) => s.resendVerification)
  const isLoading = useAuthStore((s) => s.isLoading)

  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError('Enter a valid email address')
      return
    }
    setEmailError('')
    try {
      await resendVerification(trimmed)
      setSent(true)
    } catch {
      toast.error('Could not send verification email. Please try again.')
    }
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <a href="#" className="flex items-center gap-2 self-center font-medium">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <IconLayoutRows className="size-4" />
          </div>
          Acme Inc.
        </a>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-xl">Resend verification email</CardTitle>
              <CardDescription>
                {sent
                  ? "Check your inbox for a new verification code."
                  : "Enter your email address and we'll send you a new verification code."}
              </CardDescription>
            </CardHeader>
            {!sent && (
              <CardContent>
                <form onSubmit={handleSubmit} noValidate>
                  <FieldGroup>
                    <Field data-invalid={emailError ? 'true' : undefined}>
                      <FieldLabel htmlFor="email">Email</FieldLabel>
                      <Input
                        id="email"
                        type="email"
                        placeholder="m@example.com"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value)
                          if (emailError) setEmailError('')
                        }}
                        disabled={isLoading}
                        autoComplete="email"
                      />
                      {emailError && <FieldError>{emailError}</FieldError>}
                    </Field>

                    <Field>
                      <Button type="submit" disabled={isLoading || !email.trim()}>
                        {isLoading ? 'Sending…' : 'Send verification code'}
                      </Button>
                    </Field>
                  </FieldGroup>
                </form>
              </CardContent>
            )}
          </Card>

          <FieldDescription className="px-6 text-center">
            Already have a code?{' '}
            <a href="/auth/verify-email" className="underline underline-offset-4 hover:text-primary">
              Verify your email
            </a>
            {' · '}
            <a href="/login" className="underline underline-offset-4 hover:text-primary">
              Back to sign in
            </a>
          </FieldDescription>
        </div>
      </div>
    </div>
  )
}
