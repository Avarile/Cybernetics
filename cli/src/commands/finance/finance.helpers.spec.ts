import type { ApiClient } from '../../core/http/api.client';
import {
  budgetMorePagesNote,
  morePagesNote,
  resolveAccountNames,
  resolveCategoryNames,
  type BudgetListEnvelope,
} from './finance.helpers';

describe('finance.helpers', () => {
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

  describe('budgetMorePagesNote', () => {
    it('computes remaining rows from the requested page/limit, since the envelope carries neither', () => {
      const envelope: BudgetListEnvelope = { rows: [{ id: 'b1' } as never], total: 3 };
      const note = budgetMorePagesNote(envelope, 1, 1);
      expect(note).toContain('2 more record');
      expect(note).toContain('--page 2');
    });

    it('returns null once every row has been seen', () => {
      const envelope: BudgetListEnvelope = { rows: [{} as never, {} as never], total: 2 };
      expect(budgetMorePagesNote(envelope, 1, 2)).toBeNull();
    });
  });

  describe('resolveAccountNames', () => {
    it('fetches the unpaginated account list once and maps id to name', async () => {
      const get = jest.fn().mockResolvedValue([
        { id: 'a1', name: 'Operating' },
        { id: 'a2', name: 'Payroll' },
      ]);
      const client = { get } as unknown as ApiClient;

      const map = await resolveAccountNames(client);

      expect(get).toHaveBeenCalledWith('/finance/accounts');
      expect(map.get('a1')).toBe('Operating');
      expect(map.get('a2')).toBe('Payroll');
    });
  });

  describe('resolveCategoryNames', () => {
    it('fetches the unpaginated category list once and maps id to name', async () => {
      const get = jest.fn().mockResolvedValue([{ id: 'c1', name: 'Software', key: 'software', kind: 'expense', parentId: null, path: '/' }]);
      const client = { get } as unknown as ApiClient;

      const map = await resolveCategoryNames(client);

      expect(get).toHaveBeenCalledWith('/finance/categories');
      expect(map.get('c1')).toBe('Software');
    });
  });
});
