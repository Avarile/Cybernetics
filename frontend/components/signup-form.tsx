'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
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
import { registerSchema, type RegisterFormValues } from '@/lib/validations/auth.schema'

export function SignupForm({
                             className,
                             ...props
                           }: React.ComponentProps<'div'>) {
  const router = useRouter()
  const register = useAuthStore((s) => s.register)
  const isLoading = useAuthStore((s) => s.isLoading)

  const [values, setValues] = useState<RegisterFormValues>({
    email: '',
    userName: '',
    password: '',
    confirmPassword: '',
  })
  const [errors, setErrors] = useState<Partial<Record<keyof RegisterFormValues, string>>>({})

  const handleChange =
      (field: keyof RegisterFormValues) =>
          (e: React.ChangeEvent<HTMLInputElement>) => {
            setValues((v) => ({ ...v, [field]: e.target.value }))
            if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }))
          }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = registerSchema.safeParse(values)

    if (!parsed.success) {
      const fieldErrors: typeof errors = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof RegisterFormValues
        if (!fieldErrors[key]) fieldErrors[key] = issue.message
      }
      setErrors(fieldErrors)
      return
    }

    try {
      const { email } = await register(parsed.data)
      toast.success('Account created! Check your email for the verification code.')
      router.push(`/auth/verify-email?email=${encodeURIComponent(email)}`)
    } catch {
      toast.error('Could not create account. Please try again.')
    }
  }

  return (
      <div className={cn('flex flex-col gap-6', className)} {...props}>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Create your account</CardTitle>
            <CardDescription>Enter your details below to get started</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} noValidate>
              <FieldGroup>
                <Field data-invalid={errors.userName ? 'true' : undefined}>
                  <FieldLabel htmlFor="userName">Username</FieldLabel>
                  <Input
                      id="userName"
                      type="text"
                      placeholder="johndoe"
                      value={values.userName}
                      onChange={handleChange('userName')}
                      disabled={isLoading}
                      autoComplete="username"
                  />
                  {errors.userName && <FieldError>{errors.userName}</FieldError>}
                </Field>

                <Field data-invalid={errors.email ? 'true' : undefined}>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input
                      id="email"
                      type="email"
                      placeholder="m@example.com"
                      value={values.email}
                      onChange={handleChange('email')}
                      disabled={isLoading}
                      autoComplete="email"
                  />
                  {errors.email && <FieldError>{errors.email}</FieldError>}
                </Field>

                <Field data-invalid={errors.password ? 'true' : undefined}>
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <Input
                      id="password"
                      type="password"
                      value={values.password}
                      onChange={handleChange('password')}
                      disabled={isLoading}
                      autoComplete="new-password"
                  />
                  {errors.password && <FieldError>{errors.password}</FieldError>}
                </Field>

                <Field data-invalid={errors.confirmPassword ? 'true' : undefined}>
                  <FieldLabel htmlFor="confirmPassword">Confirm Password</FieldLabel>
                  <Input
                      id="confirmPassword"
                      type="password"
                      value={values.confirmPassword}
                      onChange={handleChange('confirmPassword')}
                      disabled={isLoading}
                      autoComplete="new-password"
                  />
                  {errors.confirmPassword && (
                      <FieldError>{errors.confirmPassword}</FieldError>
                  )}
                  <FieldDescription>Must be at least 8 characters.</FieldDescription>
                </Field>

                <Field>
                  <Button type="submit" disabled={isLoading}>
                    {isLoading ? 'Creating account…' : 'Create Account'}
                  </Button>
                  <FieldDescription className="text-center">
                    Already have an account?{' '}
                    <a href="/auth/login" className="underline underline-offset-4 hover:text-primary">
                      Sign in
                    </a>
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>

        <FieldDescription className="px-6 text-center">
          By clicking continue, you agree to our{' '}
          <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a>.
        </FieldDescription>
      </div>
  )
}
