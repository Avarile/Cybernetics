export type ColumnAlign = 'left' | 'right';

export interface TableColumn<T> {
  /** Header text, printed as given — callers conventionally pass UPPERCASE. */
  header: string;
  value: (row: T) => string;
  /** @default 'left' */
  align?: ColumnAlign;
  /** Cells longer than this are truncated with a trailing `…`. */
  maxWidth?: number;
}

const COLUMN_GAP = '  ';

function truncate(text: string, maxWidth: number | undefined): string {
  if (maxWidth === undefined || text.length <= maxWidth) return text;
  if (maxWidth <= 1) return text.slice(0, maxWidth);
  return `${text.slice(0, maxWidth - 1)}…`;
}

function pad(text: string, width: number, align: ColumnAlign): string {
  const fill = ' '.repeat(Math.max(0, width - text.length));
  return align === 'right' ? fill + text : text + fill;
}

/**
 * Renders `rows` as a plain, aligned text table: a header row followed by one
 * row per item, each column padded to its widest cell. No colour, no
 * box-drawing — the output stays legible piped into a file, `less`, or a
 * non-TTY consumer.
 *
 * Returns just the header line for an empty `rows` list rather than
 * throwing — callers that want a dedicated empty-state message should check
 * `rows.length` themselves before calling this.
 */
export function renderTable<T>(
  rows: readonly T[],
  columns: readonly TableColumn<T>[],
): string {
  if (columns.length === 0) return '';

  const cells = rows.map((row) => columns.map((col) => truncate(col.value(row), col.maxWidth)));

  const widths = columns.map((col, i) =>
    Math.max(col.header.length, ...cells.map((cellRow) => cellRow[i].length)),
  );

  const renderLine = (values: readonly string[]): string =>
    values
      .map((v, i) => pad(v, widths[i], columns[i].align ?? 'left'))
      .join(COLUMN_GAP)
      .trimEnd();

  const lines = [
    renderLine(columns.map((c) => c.header)),
    ...cells.map((cellRow) => renderLine(cellRow)),
  ];

  return lines.join('\n');
}
