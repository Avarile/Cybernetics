'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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

function VerifyEmailForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const email = searchParams.get('email') ?? ''

  const verifyEmail = useAuthStore((s) => s.verifyEmail)
  const resendVerification = useAuthStore((s) => s.resendVerification)
  const isLoading = useAuthStore((s) => s.isLoading)

  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const [resending, setResending] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = code.trim()
    if (trimmed.length !== 6 || !/^\d{6}$/.test(trimmed)) {
      setCodeError('Please enter the 6-digit code from your email')
      return
    }
    setCodeError('')
    try {
      await verifyEmail(trimmed)
      toast.success('Email verified! You can now sign in.')
      router.push('/login')
    } catch {
      setCodeError('Invalid or expired code. Please try again or request a new one.')
    }
  }

  const handleResend = async () => {
    if (!email) {
      toast.error('No email address found. Please register again.')
      return
    }
    setResending(true)
    try {
      await resendVerification(email)
      toast.success('A new verification code has been sent to your email.')
    } catch {
      toast.error('Could not resend verification email. Please try again.')
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Verify your email</CardTitle>
          <CardDescription>
            {email
              ? <>We sent a 6-digit code to <strong>{email}</strong></>
              : 'Enter the 6-digit code sent to your email address'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate>
            <FieldGroup>
              <Field data-invalid={codeError ? 'true' : undefined}>
                <FieldLabel htmlFor="code">Verification Code</FieldLabel>
                <Input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, ''))
                    if (codeError) setCodeError('')
                  }}
                  disabled={isLoading}
                  autoComplete="one-time-code"
                  className="text-center text-2xl tracking-[0.5em]"
                />
                {codeError && <FieldError>{codeError}</FieldError>}
              </Field>

              <Field>
                <Button type="submit" disabled={isLoading || code.length !== 6}>
                  {isLoading ? 'Verifying…' : 'Verify Email'}
                </Button>
                <FieldDescription className="text-center">
                  Didn&apos;t receive it?{' '}
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resending || !email}
                    className="underline underline-offset-4 hover:text-primary disabled:opacity-50"
                  >
                    {resending ? 'Sending…' : 'Resend code'}
                  </button>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <FieldDescription className="px-6 text-center">
        <a href="/auth/login" className="underline underline-offset-4 hover:text-primary">
          Back to sign in
        </a>
      </FieldDescription>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <a href="#" className="flex items-center gap-2 self-center font-medium">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <IconLayoutRows className="size-4" />
          </div>
          Acme Inc.
        </a>
        <Suspense fallback={null}>
          <VerifyEmailForm />
        </Suspense>
      </div>
    </div>
  )
}
