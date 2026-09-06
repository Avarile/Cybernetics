import { DocumentParseError, parseDocument, renderDocument, type EditorDocument } from './frontmatter';

describe('renderDocument / parseDocument round-trip', () => {
  it('round-trips scalars, arrays and nested objects through fields', () => {
    const doc: EditorDocument = {
      fields: {
        title: 'Hello World',
        count: 42,
        active: true,
        tags: ['a', 'b', 'c'],
        nested: { x: 1, y: { z: 2 } },
      },
      body: 'Some body text.',
    };

    const text = renderDocument(doc);

    expect(parseDocument(text)).toEqual(doc);
  });

  it('round-trips an empty body', () => {
    const doc: EditorDocument = { fields: { title: 'Foo' }, body: '' };

    expect(parseDocument(renderDocument(doc))).toEqual(doc);
  });

  it('round-trips a multi-paragraph body exactly', () => {
    const doc: EditorDocument = {
      fields: { title: 'Foo' },
      body: 'Paragraph one.\n\nParagraph two, with more text.\n\nParagraph three.',
    };

    expect(parseDocument(renderDocument(doc))).toEqual(doc);
  });

  it('does not let a --- line inside the body terminate the body', () => {
    const doc: EditorDocument = {
      fields: { title: 'Foo' },
      body: 'before the line\n---\nafter the line',
    };

    const text = renderDocument(doc);
    const parsed = parseDocument(text);

    expect(parsed.body).toBe(doc.body);
    expect(parsed.fields).toEqual(doc.fields);
  });

  it('leaves YAML-looking text in the body untouched, not parsed', () => {
    const doc: EditorDocument = {
      fields: { title: 'Foo' },
      body: 'key: value\nother: [1, 2, 3]\n# not a real comment, just text',
    };

    expect(parseDocument(renderDocument(doc))).toEqual(doc);
  });
});

describe('renderDocument', () => {
  it('emits header comment lines above the opening delimiter', () => {
    const text = renderDocument(
      { fields: { title: 'Foo' }, body: '' },
      ['Fix the issues below.', 'Second header line.'],
    );

    const lines = text.split('\n');
    expect(lines[0]).toBe('# Fix the issues below.');
    expect(lines[1]).toBe('# Second header line.');
    expect(lines[2]).toBe('---');
  });
});

describe('parseDocument', () => {
  it('ignores leading # header comment lines before the opening ---', () => {
    const text = '# a header line\n# another\n---\ntitle: Foo\n---\n\nBody.';

    expect(parseDocument(text)).toEqual({ fields: { title: 'Foo' }, body: 'Body.' });
  });

  it('drops comments inside the frontmatter block on parse', () => {
    const text = '---\ntitle: Foo # this is generated guidance\n---\n\nBody.';

    expect(parseDocument(text)).toEqual({ fields: { title: 'Foo' }, body: 'Body.' });
  });

  it('throws DocumentParseError when the first line is not ---', () => {
    const text = 'title: Foo\n---\n\nBody.';

    expect(() => parseDocument(text)).toThrow(DocumentParseError);
  });

  it('throws DocumentParseError when there is no closing ---', () => {
    const text = '---\ntitle: Foo\n\nBody.';

    expect(() => parseDocument(text)).toThrow(DocumentParseError);
  });

  it('yields an empty body when there is no body section', () => {
    const text = '---\ntitle: Foo\n---\n';

    expect(parseDocument(text)).toEqual({ fields: { title: 'Foo' }, body: '' });
  });
});
