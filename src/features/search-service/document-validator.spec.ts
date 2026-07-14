import type { FieldSpec } from '../../infrastructure/database/schema/search.schema';
import {
  fieldSpecToIndexDefinition,
  validateDocument,
  validateFieldSpec,
} from './document-validator';

const fields: FieldSpec[] = [
  { name: 'title', type: 'string', required: true, searchable: true, sortable: true },
  { name: 'body', type: 'string', searchable: true },
  { name: 'tags', type: 'string[]', filterable: true },
  { name: 'price', type: 'number', filterable: true, sortable: true },
  { name: 'status', type: 'string', filterable: true, enum: ['draft', 'live'] },
];

describe('validateFieldSpec', () => {
  it('accepts a valid spec', () => {
    expect(validateFieldSpec(fields)).toEqual([]);
  });

  it('rejects an empty spec', () => {
    expect(validateFieldSpec([]).length).toBeGreaterThan(0);
  });

  it('rejects a reserved field name', () => {
    const errs = validateFieldSpec([{ name: 'id', type: 'string', searchable: true }]);
    expect(errs.some((e) => e.includes('reserved'))).toBe(true);
  });

  it('rejects a duplicate field name', () => {
    const errs = validateFieldSpec([
      { name: 'a', type: 'string', searchable: true },
      { name: 'a', type: 'number' },
    ]);
    expect(errs.some((e) => e.includes('Duplicate'))).toBe(true);
  });

  it('rejects searchable on a non-string field', () => {
    const errs = validateFieldSpec([{ name: 'n', type: 'number', searchable: true }]);
    expect(errs.some((e) => e.includes('searchable'))).toBe(true);
  });

  it('rejects sortable on an array field', () => {
    const errs = validateFieldSpec([
      { name: 't', type: 'string', searchable: true },
      { name: 'x', type: 'string[]', sortable: true },
    ]);
    expect(errs.some((e) => e.includes('sortable'))).toBe(true);
  });

  it('requires at least one searchable field', () => {
    const errs = validateFieldSpec([{ name: 'n', type: 'number', filterable: true }]);
    expect(errs.some((e) => e.includes('searchable'))).toBe(true);
  });
});

describe('validateDocument', () => {
  it('accepts a valid document', () => {
    expect(
      validateDocument(fields, { title: 'Hi', tags: ['a'], price: 9, status: 'live' }),
    ).toEqual([]);
  });

  it('flags a missing required field', () => {
    expect(validateDocument(fields, { body: 'x' }).some((e) => e.includes('title'))).toBe(true);
  });

  it('flags an unknown field', () => {
    const errs = validateDocument(fields, { title: 'x', nope: 1 });
    expect(errs.some((e) => e.includes('Unknown field "nope"'))).toBe(true);
  });

  it('flags a type mismatch', () => {
    const errs = validateDocument(fields, { title: 123 });
    expect(errs.some((e) => e.includes('title'))).toBe(true);
  });

  it('flags an out-of-enum value', () => {
    const errs = validateDocument(fields, { title: 'x', status: 'archived' });
    expect(errs.some((e) => e.includes('status'))).toBe(true);
  });

  it('flags a bad element in a string[] field', () => {
    const errs = validateDocument(fields, { title: 'x', tags: ['ok', 5] });
    expect(errs.some((e) => e.includes('tags'))).toBe(true);
  });
});

describe('fieldSpecToIndexDefinition', () => {
  it('derives Meili attributes from field flags + system fields', () => {
    const def = fieldSpecToIndexDefinition('articles', fields);
    expect(def).toEqual({
      name: 'articles',
      primaryKey: 'id',
      searchableAttributes: ['title', 'body'],
      filterableAttributes: ['tags', 'price', 'status', 'createdAt', 'updatedAt', 'externalId'],
      sortableAttributes: ['title', 'price', 'createdAt', 'updatedAt'],
    });
  });
});
