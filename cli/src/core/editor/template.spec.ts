import { buildTemplate, templateFields } from './template';

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
