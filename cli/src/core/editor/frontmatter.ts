import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

/** The document an editor buffer parses into: structured fields plus free text. */
export interface EditorDocument {
  /** Structured fields from the YAML frontmatter block. */
  fields: Record<string, unknown>;
  /** Free text after the closing `---`. Empty string when the doc has no body. */
  body: string;
}

export class DocumentParseError extends Error {}

const DELIMITER = '---';

/**
 * Renders `doc` as `# header lines` (optional), then a YAML frontmatter block
 * bounded by `---` delimiters, then a blank separator line, then the body
 * verbatim. The body is never touched beyond that: it may itself contain
 * `---` lines or YAML-looking text without affecting the format.
 */
export function renderDocument(doc: EditorDocument, header?: string[]): string {
  const headerBlock =
    header && header.length > 0
      ? header.map((line) => (line.length > 0 ? `# ${line}` : '#')).join('\n') + '\n'
      : '';
  const yamlBlock = stringifyYaml(doc.fields ?? {});

  return `${headerBlock}${DELIMITER}\n${yamlBlock}${DELIMITER}\n\n${doc.body}`;
}

/**
 * Parses a buffer produced by (or compatible with) `renderDocument`.
 *
 * Only the frontmatter block — the text between the first two `---`
 * delimiter lines — is YAML-parsed. Everything after the closing delimiter
 * (and the single blank separator line that follows it) is the body,
 * returned as opaque text: a `---` line inside the body does not terminate
 * it, because we only ever search for the closing delimiter once, starting
 * right after the opening one.
 */
export function parseDocument(text: string): EditorDocument {
  const lines = text.split('\n');

  // Leading blank lines and `#` header comments before the opening `---`
  // are ignored; they carry no data.
  let i = 0;
  while (i < lines.length && (lines[i].trim() === '' || lines[i].trimStart().startsWith('#'))) {
    i++;
  }

  if (i >= lines.length || lines[i].trim() !== DELIMITER) {
    const found = i < lines.length ? JSON.stringify(lines[i]) : '<end of input>';
    throw new DocumentParseError(
      `expected '${DELIMITER}' to open the frontmatter block, found ${found}`,
    );
  }

  const frontmatterStart = i + 1;
  let closeIdx = frontmatterStart;
  while (closeIdx < lines.length && lines[closeIdx].trim() !== DELIMITER) {
    closeIdx++;
  }

  if (closeIdx >= lines.length) {
    throw new DocumentParseError(`missing closing '${DELIMITER}' after the frontmatter block`);
  }

  const frontmatterText = lines.slice(frontmatterStart, closeIdx).join('\n');
  const fields = (parseYaml(frontmatterText) ?? {}) as Record<string, unknown>;

  // renderDocument always inserts exactly one blank separator line after the
  // closing delimiter; skip it so the round trip doesn't gain a newline.
  let bodyStart = closeIdx + 1;
  if (bodyStart < lines.length && lines[bodyStart] === '') {
    bodyStart++;
  }
  const body = lines.slice(bodyStart).join('\n');

  return { fields, body };
}
