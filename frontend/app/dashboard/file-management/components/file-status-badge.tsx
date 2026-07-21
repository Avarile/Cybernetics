'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, CheckmarkCircle02Icon, InformationCircleIcon } from '@hugeicons/core-free-icons'
import { Badge } from '@/components/ui/badge'

type Variant = 'default' | 'secondary' | 'destructive' | 'outline'

const CONFIG: Record<string, { label: string; variant: Variant; icon: typeof Alert02Icon }> = {
  AVAILABLE: { label: 'Available', variant: 'secondary', icon: CheckmarkCircle02Icon },
  PENDING: { label: 'Pending', variant: 'outline', icon: InformationCircleIcon },
  QUARANTINED: { label: 'Quarantined', variant: 'destructive', icon: Alert02Icon },
}

export function FileStatusBadge({ status, reason }: { status: string; reason?: string | null }) {
  const cfg = CONFIG[status] ?? { label: status, variant: 'outline' as Variant, icon: InformationCircleIcon }
  const title = status === 'QUARANTINED' && reason ? `Quarantined — ${reason}` : cfg.label
  return (
    <Badge variant={cfg.variant} title={title} className="gap-1">
      <HugeiconsIcon icon={cfg.icon} strokeWidth={2} className="size-3.5" />
      {cfg.label}
    </Badge>
  )
}
