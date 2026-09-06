import { morePagesNote } from './pagination-note';

describe('morePagesNote', () => {
  it('is null when every matching row fit on this page', () => {
    expect(morePagesNote({ data: [{}, {}], total: 2, page: 1, limit: 20 })).toBeNull();
  });

  it('reports how many rows exist beyond this page', () => {
    const note = morePagesNote({ data: [{}], total: 3, page: 1, limit: 1 });
    expect(note).toContain('2');
    expect(note).toContain('--page 2');
  });

  it('accounts for the current page offset', () => {
    // page 2, limit 20, total 45: rows 1-20 already behind us, this page has
    // 20 more (21-40), 5 remain (41-45).
    const note = morePagesNote({ data: new Array(20).fill({}), total: 45, page: 2, limit: 20 });
    expect(note).toContain('5');
  });
});
