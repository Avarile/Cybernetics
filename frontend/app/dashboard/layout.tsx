'use client'
import { AuthGuard } from '@/lib/auth/guards'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>
}
