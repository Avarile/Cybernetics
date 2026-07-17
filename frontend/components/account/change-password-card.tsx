'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/lib/state-management/auth.store'
import { changePasswordSchema, type ChangePasswordFormValues } from '@/lib/validations/auth.schema'
import { scorePassword } from '@/lib/auth/password-strength'
import { ApiError } from '@/lib/http/api-client'

export function ChangePasswordCard() {
  const changePassword = useAuthStore((s) => s.changePassword)
  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })
  const strength = scorePassword(form.watch('newPassword'))

  const onSubmit = async (values: ChangePasswordFormValues) => {
    try {
      await changePassword(values.currentPassword, values.newPassword)
      // changePassword revokes all sessions + clears local state; send to login.
      toast.success('Password changed — please sign in again.')
      window.location.href = '/auth/login'
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not change password.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>You&apos;ll be signed out of all sessions afterwards.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            <Field data-invalid={form.formState.errors.currentPassword ? 'true' : undefined}>
              <FieldLabel htmlFor="currentPassword">Current password</FieldLabel>
              <Input id="currentPassword" type="password" autoComplete="current-password" {...form.register('currentPassword')} />
              {form.formState.errors.currentPassword && <FieldError>{form.formState.errors.currentPassword.message}</FieldError>}
            </Field>
            <Field data-invalid={form.formState.errors.newPassword ? 'true' : undefined}>
              <FieldLabel htmlFor="newPassword">New password</FieldLabel>
              <Input id="newPassword" type="password" autoComplete="new-password" {...form.register('newPassword')} />
              {form.watch('newPassword') && <p className="text-xs text-muted-foreground">Strength: {strength.label}</p>}
              {form.formState.errors.newPassword && <FieldError>{form.formState.errors.newPassword.message}</FieldError>}
            </Field>
            <Field data-invalid={form.formState.errors.confirmPassword ? 'true' : undefined}>
              <FieldLabel htmlFor="confirmPassword">Confirm new password</FieldLabel>
              <Input id="confirmPassword" type="password" autoComplete="new-password" {...form.register('confirmPassword')} />
              {form.formState.errors.confirmPassword && <FieldError>{form.formState.errors.confirmPassword.message}</FieldError>}
            </Field>
            <Button type="submit" disabled={form.formState.isSubmitting}>Change password</Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
