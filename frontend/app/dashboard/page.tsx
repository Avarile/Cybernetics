'use client'

import { Button } from '@/components/ui/button'
import { useUser, useAuthStore } from '@/lib/state-management/auth.store'
import { deriveDisplayName } from '@/lib/auth/display-name'

export default function DashboardPage() {
  const user = useUser()
  const logout = useAuthStore((s) => s.logout)
  return (
    <div className="flex min-h-svh flex-col gap-4 p-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-muted-foreground">
        Signed in as <strong>{user ? deriveDisplayName(user) : '…'}</strong> ({user?.role})
      </p>
      <div className="flex gap-3">
        <Button asChild variant="outline"><a href="/account">Account</a></Button>
        <Button variant="destructive" onClick={() => { void logout().then(() => (window.location.href = '/auth/login')) }}>
          Log out
        </Button>
      </div>
    </div>
  )
}
