'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
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
  FieldSeparator,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/lib/state-management/auth.store'
import { loginSchema, type LoginFormValues } from '@/lib/validations/auth.schema'

export function LoginForm({
                            className,
                            ...props
                          }: React.ComponentProps<'div'>) {
  const searchParams = useSearchParams()
  const login = useAuthStore((s) => s.login)
  const isLoading = useAuthStore((s) => s.isLoading)

  const [values, setValues] = useState<LoginFormValues>({ email: '', password: '' })
  const [errors, setErrors] = useState<Partial<Record<keyof LoginFormValues, string>>>({})

  const handleChange =
      (field: keyof LoginFormValues) =>
          (e: React.ChangeEvent<HTMLInputElement>) => {
            setValues((v) => ({ ...v, [field]: e.target.value }))
            if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }))
          }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = loginSchema.safeParse(values)

    if (!parsed.success) {
      const fieldErrors: typeof errors = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof LoginFormValues
        if (!fieldErrors[key]) fieldErrors[key] = issue.message
      }
      setErrors(fieldErrors)
      return
    }

    try {
      await login(parsed.data)
      toast.success('Welcome back!')
      const callbackUrl = searchParams.get('callbackUrl') ?? '/dashboard'
      // Hard navigation so the browser sends the fresh session_token cookie
      // to the proxy on the very next request, guaranteeing the route guard
      // sees it before deciding whether to allow or redirect.
      window.location.href = callbackUrl
    } catch (err: unknown) {
      const message = (err as { message?: string })?.message ?? ''
      if (message.includes('verify your email') || message.includes('AUTH_010')) {
        toast.error('Please verify your email before signing in.', {
          action: {
            label: 'Verify now',
            onClick: () => {
              window.location.href = `/verify-email?email=${encodeURIComponent(values.email)}`
            },
          },
        })
      } else {
        toast.error('Invalid credentials. Please try again.')
      }
    }
  }

  const handleGoogleLogin = () => {
    window.location.href = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/auth/google`
  }

  return (
      <div className={cn('flex flex-col gap-6', className)} {...props}>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Welcome back</CardTitle>
            <CardDescription>Login with your Google account or email</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} noValidate>
              <FieldGroup>
                <Field>
                  <Button
                      variant="outline"
                      type="button"
                      onClick={handleGoogleLogin}
                      disabled={isLoading}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                      <path
                          d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
                          fill="currentColor"
                      />
                    </svg>
                    Login with Google
                  </Button>
                </Field>

                <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
                  Or continue with
                </FieldSeparator>

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
                  <div className="flex items-center">
                    <FieldLabel htmlFor="password">Password</FieldLabel>
                    <a
                        href="/auth/forgot-password"
                        className="ml-auto text-sm underline-offset-4 hover:underline"
                    >
                      Forgot your password?
                    </a>
                  </div>
                  <Input
                      id="password"
                      type="password"
                      value={values.password}
                      onChange={handleChange('password')}
                      disabled={isLoading}
                      autoComplete="current-password"
                  />
                  {errors.password && <FieldError>{errors.password}</FieldError>}
                </Field>

                <Field>
                  <Button type="submit" disabled={isLoading}>
                    {isLoading ? 'Signing in…' : 'Login'}
                  </Button>
                  <FieldDescription className="text-center">
                    Don&apos;t have an account?{' '}
                    <a href="/auth/signup" className="underline underline-offset-4 hover:text-primary">
                      Sign up
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
