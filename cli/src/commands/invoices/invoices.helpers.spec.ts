import { billToName, morePagesNote } from './invoices.helpers';

describe('invoices.helpers', () => {
  describe('morePagesNote', () => {
    it('reports remaining rows on a later page', () => {
      const note = morePagesNote({ data: [{}], total: 3, page: 1, limit: 1 });
      expect(note).toContain('2 more record');
      expect(note).toContain('--page 2');
    });

    it('returns null once every row has been seen', () => {
      expect(morePagesNote({ data: [{}, {}], total: 2, page: 1, limit: 2 })).toBeNull();
    });
  });

  describe('billToName', () => {
    it('reads the name frozen onto the invoice at creation', () => {
      expect(billToName({ kind: 'contact', name: 'Ada Lovelace' })).toBe('Ada Lovelace');
      expect(billToName({ kind: 'company', name: 'Acme Corp' })).toBe('Acme Corp');
    });

    it('returns an empty string when there is no snapshot name', () => {
      expect(billToName({})).toBe('');
    });
  });
});
