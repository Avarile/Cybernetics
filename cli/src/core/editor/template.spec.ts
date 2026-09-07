import { buildTemplate, templateFields } from './template';
import type { KeyBackedField } from '../resolve/vocabulary';

// A small hand-written schema fixture, shaped like the real generated DTOs
// but deliberately not depending on src/generated/schemas.ts (which changes).
const schema = {
  type: 'object',
  properties: {
    title: { type: 'string', maxLength: 500 },
    slug: { type: 'string', maxLength: 255 },
    status: { type: 'string', enum: ['draft', 'published', 'archived'], default: 'draft' },
    visibility: { type: 'string', enum: ['private', 'internal'], default: 'private' },
    language: { type: 'string', maxLength: 16, default: 'en' },
    reviewDueAt: { type: 'string', format: 'date-time' },
    summary: { type: 'string', maxLength: 1000 },
    notes: { type: 'string' },
    body: { type: 'string', maxLength: 2000000 },
  },
  required: ['title'],
};

function lines(text: string): string[] {
  return text.split('\n');
}

function findLine(text: string, startsWith: string): string | undefined {
  return lines(text).find((l) => l.trimStart().startsWith(startsWith) || l.startsWith(startsWith));
}

describe('templateFields', () => {
  it('returns exactly the frontmatter keys plus the body field', () => {
    const fields = templateFields(schema, 'body');

    expect(fields.sort()).toEqual(
      ['title', 'slug', 'status', 'visibility', 'language', 'reviewDueAt', 'summary', 'notes', 'body'].sort(),
    );
  });

  it('returns schema properties only when no bodyField is given', () => {
    const fields = templateFields(schema);

    expect(fields.sort()).toEqual(
      ['title', 'slug', 'status', 'visibility', 'language', 'reviewDueAt', 'summary', 'notes', 'body'].sort(),
    );
  });

  it('includes the body field even when it is not itself a schema property', () => {
    const noBodySchema = {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
    };

    const fields = templateFields(noBodySchema, 'content');

    expect(fields.sort()).toEqual(['title', 'content'].sort());
  });
});

describe('buildTemplate — schema comments', () => {
  it('renders an enum comment as values joined by |', () => {
    const text = buildTemplate({ schema, current: { title: 'x', status: 'draft' } });

    const line = findLine(text, 'status:');
    expect(line).toContain('draft|published|archived');
  });

  it('renders a maxLength comment as "max N"', () => {
    const text = buildTemplate({ schema, current: { title: 'x' } });

    const line = findLine(text, 'summary:');
    expect(line).toContain('max 1000');
  });

  it('combines multiple facts, comma-separated', () => {
    const text = buildTemplate({ schema, current: { title: 'x' } });

    // language: maxLength 16 + default 'en' => both facts present.
    const line = findLine(text, 'language:');
    expect(line).toContain('max 16');
    expect(line).toContain('default en');
  });

  it('renders format verbatim', () => {
    const text = buildTemplate({ schema, current: { title: 'x' } });

    const line = findLine(text, '# reviewDueAt:') ?? findLine(text, 'reviewDueAt:');
    expect(line).toContain('date-time');
  });

  it('emits no comment when the schema offers no facts for a field', () => {
    const text = buildTemplate({ schema, current: { title: 'x', notes: 'hi' } });

    const line = findLine(text, 'notes:');
    expect(line).not.toContain('#');
  });
});

describe('buildTemplate — create (no current)', () => {
  it('emits required fields uncommented', () => {
    const text = buildTemplate({ schema });

    const line = findLine(text, 'title:');
    expect(line).toBeDefined();
    expect(line!.startsWith('title:')).toBe(true);
  });

  it('emits optional fields commented out', () => {
    const text = buildTemplate({ schema });

    const line = findLine(text, '# status:');
    expect(line).toBeDefined();
    expect(line!.trimStart().startsWith('#')).toBe(true);
  });
});

describe('buildTemplate — edit (current present)', () => {
  it('emits every schema field uncommented, populated from current', () => {
    const text = buildTemplate({
      schema,
      current: { title: 'Existing Title', status: 'published' },
    });

    const titleLine = findLine(text, 'title:')!;
    const statusLine = findLine(text, 'status:')!;

    expect(titleLine.startsWith('title:')).toBe(true);
    expect(titleLine).toContain('Existing Title');
    expect(statusLine.startsWith('status:')).toBe(true);
    expect(statusLine).toContain('published');
  });

  it('renders a field absent from current as empty, still uncommented', () => {
    const text = buildTemplate({ schema, current: { title: 'x' } });

    const line = findLine(text, 'summary:')!;
    expect(line.startsWith('summary:')).toBe(true);
  });
});

describe('buildTemplate — body field extraction', () => {
  it('excludes bodyField from the frontmatter and uses it as the document body', () => {
    const text = buildTemplate({
      schema,
      current: { title: 'x', body: 'This is the body text.' },
      bodyField: 'body',
    });

    expect(findLine(text, 'body:')).toBeUndefined();
    expect(text).toContain('This is the body text.');
    expect(text.endsWith('This is the body text.')).toBe(true);
  });
});

describe('buildTemplate — date-time rendering', () => {
  it('renders a midnight-UTC date-time as YYYY-MM-DD', () => {
    const text = buildTemplate({
      schema,
      current: { title: 'x', reviewDueAt: '2024-03-15T00:00:00.000Z' },
    });

    const line = findLine(text, 'reviewDueAt:')!;
    expect(line).toContain('2024-03-15');
    expect(line).not.toContain('T00:00:00');
  });

  it('renders a non-midnight date-time as full ISO', () => {
    const text = buildTemplate({
      schema,
      current: { title: 'x', reviewDueAt: '2024-03-15T13:45:00.000Z' },
    });

    const line = findLine(text, 'reviewDueAt:')!;
    expect(line).toContain('2024-03-15T13:45:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// Key-backed fields (Task 4). A separate hand-written schema fixture, shaped
// like CreateContactDto/UpdateContactDto's id fields, kept apart from `schema`
// above so none of the pre-existing tests shift meaning.
//
// Design choice, stated here because it departs from the plan's illustrative
// interface: `buildTemplate` stays SYNCHRONOUS. Rather than an injected
// `resolveKeys: (field, ids) => Promise<string[]>` callback, the caller
// resolves ids to keys itself (via `VocabularyIndex.toKey`/`toKeys` --
// core/resolve/vocabulary.ts, Task 1) *before* calling `buildTemplate`, and
// hands the already-resolved value in `current[bufferField]`.
// `current[dtoField]` (the raw id) is never read for a key-backed field.
// This keeps template.ts free of `await` and leaves its ~19 other call sites
// (companies, finance, invoices, projects, tags, tasks, vocabulary-crud --
// none of which ever pass `keyBacked`) completely untouched, instead of
// making `buildTemplate` async and threading `await` through every one of
// them for a capability only two callers use. See
// commands/contacts/contacts.helpers.ts and commands/knowledge/knowledge.helpers.ts
// for where the actual (async, HTTP-backed) resolution happens.
// ---------------------------------------------------------------------------
const vocabSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', maxLength: 500 },
    typeId: { type: 'string', format: 'uuid' },
    categoryId: { type: 'string', format: 'uuid' },
    tagIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
    companyId: { type: 'string', format: 'uuid' },
  },
  required: ['title'],
};

const TYPE_FIELD: KeyBackedField = { bufferField: 'type', dtoField: 'typeId', many: false, kind: 'contact-type' };
const CATEGORY_FIELD: KeyBackedField = {
  bufferField: 'category',
  dtoField: 'categoryId',
  many: false,
  kind: 'contact-category',
};
const TAGS_FIELD: KeyBackedField = {
  bufferField: 'tags',
  dtoField: 'tagIds',
  many: true,
  kind: 'tag',
  scope: 'contact',
};
const COMPANY_FIELD: KeyBackedField = { bufferField: 'company', dtoField: 'companyId', many: false, kind: 'company' };
const VOCAB_KEY_BACKED: KeyBackedField[] = [TYPE_FIELD, CATEGORY_FIELD, TAGS_FIELD, COMPANY_FIELD];

describe('templateFields — key-backed rename', () => {
  it('reports buffer names instead of dtoField names when keyBacked is given', () => {
    const fields = templateFields(vocabSchema, undefined, VOCAB_KEY_BACKED);

    expect(fields.sort()).toEqual(['title', 'type', 'category', 'tags', 'company'].sort());
    expect(fields).not.toContain('typeId');
    expect(fields).not.toContain('categoryId');
    expect(fields).not.toContain('tagIds');
    expect(fields).not.toContain('companyId');
  });

  it('reports dtoField names unchanged when keyBacked is omitted (regression guard)', () => {
    const fields = templateFields(vocabSchema);

    expect(fields).toContain('typeId');
    expect(fields).not.toContain('type');
  });
});

describe('buildTemplate — key-backed fields, create (no current)', () => {
  it('renders a scalar key-backed field renamed, empty, commented out, with a kind + ls-command comment', () => {
    const text = buildTemplate({ schema: vocabSchema, keyBacked: VOCAB_KEY_BACKED });

    const line = findLine(text, '# type:');
    expect(line).toBeDefined();
    expect(line).toContain('key — see: cyb contacts type ls');
  });

  it('never renders the raw dtoField name for a key-backed field', () => {
    const text = buildTemplate({ schema: vocabSchema, keyBacked: VOCAB_KEY_BACKED });

    expect(findLine(text, 'typeId:')).toBeUndefined();
    expect(findLine(text, '# typeId:')).toBeUndefined();
  });

  it('renders a `many` key-backed field renamed, as an empty list, with a "keys" comment naming its scope', () => {
    const text = buildTemplate({ schema: vocabSchema, keyBacked: VOCAB_KEY_BACKED });

    const line = findLine(text, '# tags:');
    expect(line).toBeDefined();
    expect(line).toContain('[]');
    expect(line).toContain('keys — see: cyb tags ls --scope contact');
  });

  it('renders the company field with its own ls command, not a type/category one', () => {
    const text = buildTemplate({ schema: vocabSchema, keyBacked: VOCAB_KEY_BACKED });

    const line = findLine(text, '# company:');
    expect(line).toContain('key — see: cyb companies ls');
  });
});

describe('buildTemplate — key-backed fields, edit (current present)', () => {
  it('renders the resolved key from current[bufferField], uncommented, renamed from dtoField', () => {
    const text = buildTemplate({
      schema: vocabSchema,
      current: { title: 'x', type: 'customer' },
      keyBacked: VOCAB_KEY_BACKED,
    });

    const line = findLine(text, 'type:')!;
    expect(line.startsWith('type:')).toBe(true);
    expect(line).toContain('customer');
    expect(line).toContain('key — see: cyb contacts type ls');
  });

  it('renders a `many` field as a flow list of already-resolved keys', () => {
    const text = buildTemplate({
      schema: vocabSchema,
      current: { title: 'x', tags: ['security', 'urgent'] },
      keyBacked: VOCAB_KEY_BACKED,
    });

    // formatScalar's flow-style yaml stringify (shared with every other
    // array-typed field this module renders) puts spaces inside the
    // brackets for a non-empty list -- `[]` is the only bracket form with
    // no spacing, which the create-path test above already covers.
    const line = findLine(text, 'tags:')!;
    expect(line).toContain('[ security, urgent ]');
  });

  it('renders whatever value it is handed for an unresolved id, unmodified -- the raw-id fallback is VocabularyIndex.toKey\'s job, not template.ts\'s', () => {
    const text = buildTemplate({
      schema: vocabSchema,
      current: { title: 'x', type: 'some-deleted-id-that-never-round-tripped' },
      keyBacked: VOCAB_KEY_BACKED,
    });

    const line = findLine(text, 'type:')!;
    expect(line).toContain('some-deleted-id-that-never-round-tripped');
  });

  it('reads current[bufferField] only -- current[dtoField] (the raw id) is ignored for a key-backed field', () => {
    const text = buildTemplate({
      schema: vocabSchema,
      current: { title: 'x', typeId: 'aaaaaaaa-1111-1111-1111-111111111111', type: 'customer' },
      keyBacked: VOCAB_KEY_BACKED,
    });

    const line = findLine(text, 'type:')!;
    expect(line).toContain('customer');
    expect(line).not.toContain('aaaaaaaa');
  });
});

describe('buildTemplate — no keyBacked (regression guard)', () => {
  it('renders typeId etc. exactly as before -- untouched by unrelated dtoField names', () => {
    const text = buildTemplate({
      schema: vocabSchema,
      current: { title: 'x', typeId: 'aaaaaaaa-1111-1111-1111-111111111111' },
    });

    const line = findLine(text, 'typeId:')!;
    expect(line.startsWith('typeId:')).toBe(true);
    expect(line).toContain('aaaaaaaa-1111-1111-1111-111111111111');
    expect(line).toContain('uuid');
  });
});
