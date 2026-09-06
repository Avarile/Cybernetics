import type { ApiIssue } from '../errors';
import { annotate } from './issues';

const buffer = [
  '---',
  'title: ""',
  'slug: my-slug',
  'tagIds: [aaa, bbb]',
  '---',
  '',
  'Body text.',
].join('\n');

describe('annotate', () => {
  it('returns the text unchanged for an empty issue list', () => {
    expect(annotate(buffer, [])).toBe(buffer);
  });

  it('inserts a comment above the matching field, on its own line', () => {
    const issues: ApiIssue[] = [{ path: ['title'], message: 'must not be empty' }];

    const result = annotate(buffer, issues);
    const lines = result.split('\n');
    const fieldIdx = lines.findIndex((l) => l.startsWith('title:'));

    expect(lines[fieldIdx - 1]).toBe('# ✗ title: must not be empty');
  });

  it('annotates two issues on different fields, each above its own field', () => {
    const issues: ApiIssue[] = [
      { path: ['title'], message: 'must not be empty' },
      { path: ['slug'], message: 'invalid format' },
    ];

    const result = annotate(buffer, issues);
    const lines = result.split('\n');
    const titleIdx = lines.findIndex((l) => l.startsWith('title:'));
    const slugIdx = lines.findIndex((l) => l.startsWith('slug:'));

    expect(lines[titleIdx - 1]).toBe('# ✗ title: must not be empty');
    expect(lines[slugIdx - 1]).toBe('# ✗ slug: invalid format');
  });

  it('renders a nested path dotted, anchored on the first segment', () => {
    const issues: ApiIssue[] = [{ path: ['tagIds', 0], message: 'invalid uuid' }];

    const result = annotate(buffer, issues);
    const lines = result.split('\n');
    const fieldIdx = lines.findIndex((l) => l.startsWith('tagIds:'));

    expect(lines[fieldIdx - 1]).toBe('# ✗ tagIds.0: invalid uuid');
  });

  it('collects an issue for an unmatched field into a header block, never dropping it', () => {
    const issues: ApiIssue[] = [{ path: ['unknownField'], message: 'not recognized' }];

    const result = annotate(buffer, issues);

    expect(result).toContain('# ✗ unknownField: not recognized');
  });

  it('places an unmatched issue directly under an existing header, above the frontmatter', () => {
    const withHeader = ['# Fix the issues below.', '---', 'title: ""', '---', '', ''].join('\n');
    const issues: ApiIssue[] = [{ path: ['unknownField'], message: 'not recognized' }];

    const result = annotate(withHeader, issues);
    const lines = result.split('\n');

    expect(lines[0]).toBe('# Fix the issues below.');
    expect(lines[1]).toBe('# ✗ unknownField: not recognized');
    expect(lines[2]).toBe('---');
  });

  it('strips stale annotations from a previous round before adding new ones', () => {
    const already = annotate(buffer, [{ path: ['title'], message: 'first round message' }]);

    const result = annotate(already, [{ path: ['slug'], message: 'second round message' }]);

    expect(result).not.toContain('first round message');
    expect(result).toContain('second round message');
    // Exactly one stale-marker line remains: the fresh one.
    const markerCount = result.split('\n').filter((l) => l.includes('✗')).length;
    expect(markerCount).toBe(1);
  });

  it('never reorders, reformats, or reindents the user\'s content', () => {
    const issues: ApiIssue[] = [{ path: ['title'], message: 'must not be empty' }];

    const result = annotate(buffer, issues);

    expect(result).toContain('slug: my-slug');
    expect(result).toContain('tagIds: [aaa, bbb]');
    expect(result).toContain('Body text.');
  });

  it('preserves an indented key\'s own indentation on the inserted comment', () => {
    const indented = ['---', '  title: ""', '---', '', ''].join('\n');
    const issues: ApiIssue[] = [{ path: ['title'], message: 'must not be empty' }];

    const result = annotate(indented, issues);
    const lines = result.split('\n');
    const fieldIdx = lines.findIndex((l) => l.trimStart().startsWith('title:'));

    expect(lines[fieldIdx - 1]).toBe('  # ✗ title: must not be empty');
  });

  it('never strips a body line that happens to match the annotation pattern', () => {
    const withBodyMarker = [
      '---',
      'title: ""',
      '---',
      '',
      '# ✗ Known issue: the old parser drops trailing commas',
      '',
      'Rest of the article.',
    ].join('\n');
    const issues: ApiIssue[] = [{ path: ['title'], message: 'must not be empty' }];

    const result = annotate(withBodyMarker, issues);

    expect(result).toContain('# ✗ Known issue: the old parser drops trailing commas');
    expect(result).toContain('Rest of the article.');
  });

  it('still replaces a stale frontmatter annotation, not just leaves the body one alone', () => {
    const withBodyMarker = [
      '---',
      'title: ""',
      '---',
      '',
      '# ✗ Known issue: the old parser drops trailing commas',
    ].join('\n');
    const already = annotate(withBodyMarker, [{ path: ['title'], message: 'first round' }]);

    const result = annotate(already, [{ path: ['title'], message: 'second round' }]);

    // The body's own "annotation-shaped" line survives untouched...
    expect(result).toContain('# ✗ Known issue: the old parser drops trailing commas');
    // ...while the real frontmatter annotation is replaced, not duplicated.
    expect(result).not.toContain('first round');
    const titleMarkerCount = result
      .split('\n')
      .filter((l) => l.includes('✗') && l.includes('title')).length;
    expect(titleMarkerCount).toBe(1);
    expect(result).toContain('second round');
  });
});
