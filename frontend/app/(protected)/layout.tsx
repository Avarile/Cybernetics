'use client'
import { AuthGuard } from '@/lib/auth/guards'

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>
}
