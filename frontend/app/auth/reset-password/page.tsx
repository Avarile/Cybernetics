'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ApiError } from '@/lib/http/api-client'
import { useAuthStore } from '@/lib/state-management/auth.store'
import { resetPasswordSchema, type ResetPasswordFormValues } from '@/lib/validations/auth.schema'

export default function ResetPasswordPage() {
  const router = useRouter()
  const resetPassword = useAuthStore((s) => s.resetPassword)
  const isLoading = useAuthStore((s) => s.isLoading)

  const [values, setValues] = useState<ResetPasswordFormValues>({
    token: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [errors, setErrors] = useState<Partial<Record<keyof ResetPasswordFormValues, string>>>({})

  const handleChange =
    (field: keyof ResetPasswordFormValues) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = field === 'token' ? e.target.value.replace(/\D/g, '') : e.target.value
      setValues((v) => ({ ...v, [field]: value }))
      if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }))
    }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = resetPasswordSchema.safeParse(values)
    if (!parsed.success) {
      const fieldErrors: typeof errors = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof ResetPasswordFormValues
        if (!fieldErrors[key]) fieldErrors[key] = issue.message
      }
      setErrors(fieldErrors)
      return
    }
    try {
      await resetPassword(parsed.data.token, parsed.data.newPassword)
      toast.success('Password reset successfully! You can now sign in.')
      router.push('/login')
    } catch (err: unknown) {
      if (err instanceof ApiError && (err.message.includes('expired') || err.message.includes('invalid'))) {
        setErrors({ token: 'Invalid or expired code. Please request a new one.' })
      } else {
        toast.error('Something went wrong. Please try again.')
      }
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
              <CardTitle className="text-xl">Reset your password</CardTitle>
              <CardDescription>
                Enter the 6-digit code from your email and choose a new password.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} noValidate>
                <FieldGroup>
                  <Field data-invalid={errors.token ? 'true' : undefined}>
                    <FieldLabel htmlFor="token">Reset Code</FieldLabel>
                    <Input
                      id="token"
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="123456"
                      value={values.token}
                      onChange={handleChange('token')}
                      disabled={isLoading}
                      autoComplete="one-time-code"
                      className="text-center text-2xl tracking-[0.5em]"
                    />
                    {errors.token && <FieldError>{errors.token}</FieldError>}
                  </Field>

                  <Field data-invalid={errors.newPassword ? 'true' : undefined}>
                    <FieldLabel htmlFor="newPassword">New Password</FieldLabel>
                    <Input
                      id="newPassword"
                      type="password"
                      value={values.newPassword}
                      onChange={handleChange('newPassword')}
                      disabled={isLoading}
                      autoComplete="new-password"
                    />
                    <FieldDescription className="text-xs text-muted-foreground">
                      Min 8 characters with uppercase, lowercase, number, and symbol
                    </FieldDescription>
                    {errors.newPassword && <FieldError>{errors.newPassword}</FieldError>}
                  </Field>

                  <Field data-invalid={errors.confirmPassword ? 'true' : undefined}>
                    <FieldLabel htmlFor="confirmPassword">Confirm New Password</FieldLabel>
                    <Input
                      id="confirmPassword"
                      type="password"
                      value={values.confirmPassword}
                      onChange={handleChange('confirmPassword')}
                      disabled={isLoading}
                      autoComplete="new-password"
                    />
                    {errors.confirmPassword && <FieldError>{errors.confirmPassword}</FieldError>}
                  </Field>

                  <Field>
                    <Button
                      type="submit"
                      disabled={
                        isLoading ||
                        values.token.length !== 6 ||
                        !values.newPassword ||
                        !values.confirmPassword
                      }
                    >
                      {isLoading ? 'Resetting…' : 'Reset Password'}
                    </Button>
                  </Field>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>

          <FieldDescription className="px-6 text-center">
            Didn&apos;t get a code?{' '}
            <a href="/auth/forgot-password" className="underline underline-offset-4 hover:text-primary">
              Request a new one
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
