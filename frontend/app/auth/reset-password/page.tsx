'use client'

import { Suspense } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/lib/state-management/auth.store'
import { resetPasswordSchema, type ResetPasswordFormValues } from '@/lib/validations/auth.schema'
import { scorePassword } from '@/lib/auth/password-strength'
import { ApiError } from '@/lib/http/api-client'

function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const resetPassword = useAuthStore((s) => s.resetPassword)

  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { email: searchParams.get('email') ?? '', code: '', newPassword: '', confirmPassword: '' },
  })

  const pw = form.watch('newPassword')
  const strength = scorePassword(pw)

  const onSubmit = async (values: ResetPasswordFormValues) => {
    try {
      await resetPassword({ email: values.email, code: values.code, newPassword: values.newPassword })
      toast.success('Password reset. Please sign in.')
      router.replace('/auth/login')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Reset failed. Check your code and try again.')
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={form.formState.errors.email ? 'true' : undefined}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
          {form.formState.errors.email && <FieldError>{form.formState.errors.email.message}</FieldError>}
        </Field>
        <Field data-invalid={form.formState.errors.code ? 'true' : undefined}>
          <FieldLabel htmlFor="code">6-digit code</FieldLabel>
          <Input id="code" inputMode="numeric" maxLength={6} {...form.register('code')} />
          {form.formState.errors.code && <FieldError>{form.formState.errors.code.message}</FieldError>}
        </Field>
        <Field data-invalid={form.formState.errors.newPassword ? 'true' : undefined}>
          <FieldLabel htmlFor="newPassword">New password</FieldLabel>
          <Input id="newPassword" type="password" autoComplete="new-password" {...form.register('newPassword')} />
          {pw && <p className="text-xs text-muted-foreground">Strength: {strength.label}</p>}
          {form.formState.errors.newPassword && <FieldError>{form.formState.errors.newPassword.message}</FieldError>}
        </Field>
        <Field data-invalid={form.formState.errors.confirmPassword ? 'true' : undefined}>
          <FieldLabel htmlFor="confirmPassword">Confirm password</FieldLabel>
          <Input id="confirmPassword" type="password" autoComplete="new-password" {...form.register('confirmPassword')} />
          {form.formState.errors.confirmPassword && <FieldError>{form.formState.errors.confirmPassword.message}</FieldError>}
        </Field>
        <Button type="submit" disabled={form.formState.isSubmitting}>Reset password</Button>
      </FieldGroup>
    </form>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Set a new password</CardTitle>
            <CardDescription>Enter the code we emailed you</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense><ResetPasswordForm /></Suspense>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
