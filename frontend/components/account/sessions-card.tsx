'use client'

import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useSessions } from '@/lib/hooks/use-sessions'
import { authService } from '@/lib/services/auth.service'
import { useAuthStore } from '@/lib/state-management/auth.store'

export function SessionsCard() {
  const { sessions, isLoading, mutate } = useSessions()
  const logout = useAuthStore((s) => s.logout)

  const revokeAllOthers = async () => {
    try {
      await authService.logoutAll()
      toast.success('All sessions signed out. Please sign in again.')
      await logout()
      window.location.href = '/auth/login'
    } catch {
      toast.error('Could not revoke sessions.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>Devices currently signed in to your account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {sessions.map((s) => (
              <li key={s.id} className="flex justify-between gap-4 border-b pb-2">
                <span className="truncate">{s.userAgent ?? 'Unknown device'}</span>
                <span className="text-muted-foreground">{s.ip ?? '—'}</span>
              </li>
            ))}
            {sessions.length === 0 && <li className="text-muted-foreground">No sessions.</li>}
          </ul>
        )}
        <Button variant="destructive" onClick={revokeAllOthers}>Sign out of all sessions</Button>
      </CardContent>
    </Card>
  )
}
