'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/lib/state-management/auth.store'
import { loginSchema, type LoginFormValues } from '@/lib/validations/auth.schema'
import { ApiError } from '@/lib/http/api-client'

export function LoginForm({ className, ...props }: React.ComponentProps<'div'>) {
  const searchParams = useSearchParams()
  const login = useAuthStore((s) => s.login)

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = async (values: LoginFormValues) => {
    try {
      await login(values)
      const callbackUrl = searchParams.get('callbackUrl') ?? '/dashboard'
      // Hard navigation so the fresh refresh cookie reaches the middleware.
      window.location.href = callbackUrl
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Invalid email or password.'
      toast.error(message)
    }
  }

  const { isSubmitting } = form.formState

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Welcome back</CardTitle>
          <CardDescription>Sign in with your email and password</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <FieldGroup>
              <Field data-invalid={form.formState.errors.email ? 'true' : undefined}>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input id="email" type="email" autoComplete="email"
                  placeholder="m@example.com" {...form.register('email')} />
                {form.formState.errors.email && <FieldError>{form.formState.errors.email.message}</FieldError>}
              </Field>

              <Field data-invalid={form.formState.errors.password ? 'true' : undefined}>
                <div className="flex items-center">
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <a href="/auth/forgot-password" className="ml-auto text-sm underline-offset-4 hover:underline">
                    Forgot your password?
                  </a>
                </div>
                <Input id="password" type="password" autoComplete="current-password"
                  {...form.register('password')} />
                {form.formState.errors.password && <FieldError>{form.formState.errors.password.message}</FieldError>}
              </Field>

              <Field>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Signing in…' : 'Login'}
                </Button>
                <FieldDescription className="text-center">
                  Accounts are provisioned by an administrator.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
