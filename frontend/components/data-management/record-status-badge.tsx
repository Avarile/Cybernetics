import { Badge } from '@/components/ui/badge'
import type { IndexState } from '@/lib/interfaces/search.interface'

const MAP: Record<IndexState, { label: string; variant: 'secondary' | 'outline' | 'destructive' }> = {
  PENDING: { label: 'Indexing', variant: 'secondary' },
  INDEXED: { label: 'Indexed', variant: 'outline' },
  FAILED: { label: 'Failed', variant: 'destructive' },
}

export function RecordStatusBadge({ state, error }: { state: IndexState; error?: string | null }) {
  const { label, variant } = MAP[state]
  return <Badge variant={variant} title={error ?? undefined}>{label}</Badge>
}
