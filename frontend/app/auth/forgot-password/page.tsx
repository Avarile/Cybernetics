'use client'

import { useState } from 'react'
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
import { forgotPasswordSchema, type ForgotPasswordFormValues } from '@/lib/validations/auth.schema'

export default function ForgotPasswordPage() {
  const forgotPassword = useAuthStore((s) => s.forgotPassword)
  const isLoading = useAuthStore((s) => s.isLoading)

  const [values, setValues] = useState<ForgotPasswordFormValues>({ email: '' })
  const [errors, setErrors] = useState<Partial<Record<keyof ForgotPasswordFormValues, string>>>({})
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = forgotPasswordSchema.safeParse(values)
    if (!parsed.success) {
      const fieldErrors: typeof errors = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof ForgotPasswordFormValues
        if (!fieldErrors[key]) fieldErrors[key] = issue.message
      }
      setErrors(fieldErrors)
      return
    }
    try {
      await forgotPassword(parsed.data.email)
    } catch {
      // Intentional: always show success to prevent account enumeration
    } finally {
      setSent(true)
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
              <CardTitle className="text-xl">Forgot your password?</CardTitle>
              <CardDescription>
                {sent
                  ? "If an account exists for that email, you'll receive a 6-digit reset code shortly."
                  : "Enter your email and we'll send you a reset code."}
              </CardDescription>
            </CardHeader>
            {!sent && (
              <CardContent>
                <form onSubmit={handleSubmit} noValidate>
                  <FieldGroup>
                    <Field data-invalid={errors.email ? 'true' : undefined}>
                      <FieldLabel htmlFor="email">Email</FieldLabel>
                      <Input
                        id="email"
                        type="email"
                        placeholder="m@example.com"
                        value={values.email}
                        onChange={(e) => {
                          setValues({ email: e.target.value })
                          if (errors.email) setErrors({})
                        }}
                        disabled={isLoading}
                        autoComplete="email"
                      />
                      {errors.email && <FieldError>{errors.email}</FieldError>}
                    </Field>

                    <Field>
                      <Button type="submit" disabled={isLoading || !values.email.trim()}>
                        {isLoading ? 'Sending…' : 'Send reset code'}
                      </Button>
                    </Field>
                  </FieldGroup>
                </form>
              </CardContent>
            )}
            {sent && (
              <CardContent>
                <Button asChild variant="outline">
                  <a href="/auth/reset-password">Enter reset code</a>
                </Button>
              </CardContent>
            )}
          </Card>

          <FieldDescription className="px-6 text-center">
            <a href="/auth/login" className="underline underline-offset-4 hover:text-primary">
              Back to sign in
            </a>
          </FieldDescription>
        </div>
      </div>
    </div>
  )
}
