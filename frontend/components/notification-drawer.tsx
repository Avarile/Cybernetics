'use client'

import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useNotificationStore, useNotificationUnreadCount } from '@/lib/state-management/notification.store'
import type { INotification } from '@/lib/interfaces/notification.interface'
import { cn } from '@/lib/utils'

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}

const typeStyles: Record<INotification['notificationType'], string> = {
  info: 'bg-blue-100 text-blue-800',
  warning: 'bg-amber-100 text-amber-800',
  alert: 'bg-red-100 text-red-800',
}

function NotificationItem({ item, onMarkRead }: { item: INotification; onMarkRead: (id: number) => void }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-lg border p-3',
        !item.isRead && 'bg-muted/50',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', typeStyles[item.notificationType])}>
          {item.notificationType}
        </span>
        <span className="text-xs text-muted-foreground">{formatRelativeTime(item.createdAt)}</span>
      </div>
      <p className="text-sm font-medium leading-snug">{item.title}</p>
      <p className="text-xs text-muted-foreground">{item.message}</p>
      {!item.isRead && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 h-6 self-end px-2 text-xs"
          onClick={() => onMarkRead(item.id)}
        >
          Mark read
        </Button>
      )}
    </div>
  )
}

export function NotificationDrawer() {
  const { items, isLoading, fetchAll, markAsRead, markAllAsRead } = useNotificationStore()
  const unreadCount = useNotificationUnreadCount()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (open) {
      fetchAll()
    }
  }, [open, fetchAll])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
          <span className="sr-only">Notifications</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-[380px] flex-col p-0 sm:w-[420px]">
        <SheetHeader className="flex flex-row items-center justify-between border-b px-4 py-3">
          <SheetTitle className="text-base">Notifications</SheetTitle>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={markAllAsRead}>
              Mark all read
            </Button>
          )}
        </SheetHeader>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              No notifications
            </div>
          ) : (
            <div className="flex flex-col gap-2 p-4">
              {items.map((item) => (
                <NotificationItem key={item.id} item={item} onMarkRead={markAsRead} />
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
