import type { ColumnDef } from '@tanstack/react-table'
import { FieldCell } from '@/components/data-management/field-cell'
import type { FieldSpec, RecordHit } from '@/lib/interfaces/search.interface'

export interface RecordColumnMeta {
  field: FieldSpec
}

/** Data columns derived from the collection field specs (no select/actions). */
export function buildColumns(fields: FieldSpec[]): ColumnDef<RecordHit>[] {
  return fields.map((field) => ({
    id: field.name,
    accessorKey: field.name,
    header: field.name,
    enableSorting: !!field.sortable,
    enableHiding: true,
    meta: { field } satisfies RecordColumnMeta,
    cell: ({ getValue }) => <FieldCell field={field} value={getValue()} />,
  }))
}
