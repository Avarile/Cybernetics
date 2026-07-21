import { Badge } from '@/components/ui/badge'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

function Dash() {
  return <span className="text-muted-foreground">—</span>
}

export function FieldCell({
  field,
  value,
  highlighted,
}: {
  field: FieldSpec
  value: unknown
  highlighted?: string
}) {
  if (value === null || value === undefined || value === '') return <Dash />

  if (field.type === 'boolean') {
    return <Badge variant="outline">{value ? 'Yes' : 'No'}</Badge>
  }
  if (field.type === 'date') {
    const d = new Date(value as string)
    return <span>{Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString()}</span>
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <Dash />
    return (
      <div className="flex flex-wrap gap-1">
        {value.map((v, i) => (
          <Badge key={i} variant="outline" className="text-muted-foreground">
            {String(v)}
          </Badge>
        ))}
      </div>
    )
  }
  if (field.enum) {
    return <Badge variant="outline" className="text-muted-foreground">{String(value)}</Badge>
  }
  if (typeof highlighted === 'string' && highlighted.length) {
    return (
      <span
        className="block max-w-[28ch] truncate"
        dangerouslySetInnerHTML={{ __html: sanitizeMarks(highlighted) }}
      />
    )
  }
  return <span className="block max-w-[28ch] truncate">{String(value)}</span>
}

/** Escape everything, then re-allow only <em>/<mark> tags (Meili's default highlight tags). */
function sanitizeMarks(html: string): string {
  const escaped = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escaped.replace(/&lt;(\/?)(em|mark)&gt;/g, '<$1$2>')
}
