'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/lib/state-management/auth.store'
import { forgotPasswordSchema, type ForgotPasswordFormValues } from '@/lib/validations/auth.schema'

export default function ForgotPasswordPage() {
  const forgotPassword = useAuthStore((s) => s.forgotPassword)
  const [sent, setSent] = useState(false)
  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  })

  const onSubmit = async (values: ForgotPasswordFormValues) => {
    // Backend always returns 204 (no account enumeration); show the same message either way.
    try { await forgotPassword(values.email) } catch { /* swallow */ }
    setSent(true)
    toast.success('If that email exists, a reset code has been sent.')
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Reset your password</CardTitle>
            <CardDescription>We&apos;ll email you a 6-digit code</CardDescription>
          </CardHeader>
          <CardContent>
            {sent ? (
              <p className="text-sm text-muted-foreground">
                Check your inbox for a reset code, then{' '}
                <a className="underline" href="/auth/reset-password">enter it here</a>.
              </p>
            ) : (
              <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
                <FieldGroup>
                  <Field data-invalid={form.formState.errors.email ? 'true' : undefined}>
                    <FieldLabel htmlFor="email">Email</FieldLabel>
                    <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
                    {form.formState.errors.email && <FieldError>{form.formState.errors.email.message}</FieldError>}
                  </Field>
                  <Button type="submit" disabled={form.formState.isSubmitting}>Send reset code</Button>
                </FieldGroup>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
