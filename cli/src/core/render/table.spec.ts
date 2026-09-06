import { renderTable, type TableColumn } from './table';

interface Row {
  name: string;
  count: number;
}

const rows: Row[] = [
  { name: 'alice', count: 3 },
  { name: 'bob', count: 120 },
];

describe('renderTable', () => {
  it('pads every column to its widest cell', () => {
    const columns: TableColumn<Row>[] = [
      { header: 'NAME', value: (r) => r.name },
      { header: 'COUNT', value: (r) => String(r.count) },
    ];

    const lines = renderTable(rows, columns).split('\n');

    // NAME column's widest cell is "alice" (5 chars) vs header "NAME" (4),
    // so the header must be padded out to match.
    expect(lines[0]).toBe('NAME   COUNT');
    expect(lines[1]).toBe('alice  3');
    expect(lines[2]).toBe('bob    120');
  });

  it('right-aligns a column when asked', () => {
    const columns: TableColumn<Row>[] = [
      { header: 'NAME', value: (r) => r.name },
      { header: 'COUNT', value: (r) => String(r.count), align: 'right' },
    ];

    const lines = renderTable(rows, columns).split('\n');

    expect(lines[0]).toBe('NAME   COUNT');
    expect(lines[1]).toBe('alice      3');
    expect(lines[2]).toBe('bob      120');
  });

  it('truncates a cell longer than maxWidth with an ellipsis', () => {
    const columns: TableColumn<Row>[] = [
      { header: 'NAME', value: (r) => r.name, maxWidth: 4 },
    ];

    const lines = renderTable(rows, columns).split('\n');

    // "alice" (5) truncates to "ali…" (4); "bob" (3) fits untouched.
    expect(lines[1]).toBe('ali…');
    expect(lines[2]).toBe('bob');
  });

  it('does not truncate a cell that exactly fits maxWidth', () => {
    const columns: TableColumn<Row>[] = [{ header: 'NAME', value: (r) => r.name, maxWidth: 5 }];

    const lines = renderTable(rows, columns).split('\n');

    expect(lines[1]).toBe('alice');
  });

  it('widens a column past a short header to fit its values', () => {
    // A second column makes the widening observable: the gap before "X"
    // only lands where it does if the "ID" column grew to fit "alice-3"/
    // "bob-120" (7 chars) rather than staying at the header's width (2).
    const columns: TableColumn<Row>[] = [
      { header: 'ID', value: (r) => `${r.name}-${r.count}` },
      { header: 'X', value: () => 'x' },
    ];

    const lines = renderTable(rows, columns).split('\n');

    expect(lines[0]).toBe(`ID${' '.repeat(7)}X`);
    expect(lines[1]).toBe('alice-3  x');
    expect(lines[2]).toBe('bob-120  x');
  });

  it('does not throw on an empty row list, and emits just the header', () => {
    const columns: TableColumn<Row>[] = [
      { header: 'NAME', value: (r) => r.name },
      { header: 'COUNT', value: (r) => String(r.count) },
    ];

    expect(() => renderTable([], columns)).not.toThrow();
    expect(renderTable([], columns)).toBe('NAME  COUNT');
  });

  it('returns an empty string when there are no columns', () => {
    expect(renderTable(rows, [])).toBe('');
  });
});
