import type { ApiIssue } from '../errors';

const MARKER = '✗';
const FRONTMATTER_DELIMITER = '---';

/** Lines this module generated on a previous round, to be replaced, not accumulated. */
function isAnnotationLine(line: string): boolean {
  return new RegExp(`^\\s*#\\s*${MARKER}\\s`).test(line);
}

/**
 * Matches a frontmatter field's own line — commented out (as an unset
 * optional field from `buildTemplate`) or not — capturing its leading
 * indentation so an inserted annotation can align with it.
 */
function keyLineRegex(key: string): RegExp {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^(\\s*)(?:#\\s*)?${escaped}:`);
}

function formatIssueComment(indent: string, issue: ApiIssue): string {
  const path = issue.path.join('.');
  return `${indent}# ${MARKER} ${path}: ${issue.message}`;
}

/**
 * Renders `issues` as `# ✗ path: message` comments above their matching
 * frontmatter keys, so a rejected submission's problems show up in place.
 * Called again each round of the editor retry loop: annotations from a
 * previous call are stripped first so they never accumulate.
 *
 * An issue whose field isn't present in the buffer is never dropped — it's
 * collected into a block directly under any existing header, above the
 * frontmatter's opening delimiter.
 */
export function annotate(bufferText: string, issues: ApiIssue[]): string {
  if (issues.length === 0) return bufferText;

  const rawLines = bufferText.split('\n');
  const delimiterIdxs: number[] = [];
  rawLines.forEach((line, i) => {
    if (line.trim() === FRONTMATTER_DELIMITER) delimiterIdxs.push(i);
  });
  // annotate only ever inserts into the header block and the frontmatter, up
  // to and including its closing delimiter — never the body. Stale
  // annotations are stripped from that same region alone: filtering the
  // whole buffer would delete a body line that happens to start with the
  // marker (e.g. a knowledge article documenting the literal pattern
  // `# ✗ ...` itself). A document missing a recognizable closing delimiter
  // (mid-repair after a parse error, say) has no confirmed body to protect,
  // so it falls back to the old whole-buffer behaviour.
  const headerEnd = delimiterIdxs.length >= 2 ? delimiterIdxs[1] + 1 : rawLines.length;

  const lines = rawLines.slice(0, headerEnd).filter((line) => !isAnnotationLine(line));
  const body = rawLines.slice(headerEnd);

  const insertBefore = new Map<number, string[]>();
  const unmatched: string[] = [];

  for (const issue of issues) {
    const key = String(issue.path[0]);
    const regex = keyLineRegex(key);
    const lineIdx = lines.findIndex((line) => regex.test(line));

    if (lineIdx === -1) {
      const path = issue.path.join('.');
      unmatched.push(`# ${MARKER} ${path}: ${issue.message}`);
      continue;
    }

    const match = lines[lineIdx].match(regex)!;
    const indent = match[1];
    const comment = formatIssueComment(indent, issue);

    if (!insertBefore.has(lineIdx)) insertBefore.set(lineIdx, []);
    insertBefore.get(lineIdx)!.push(comment);
  }

  if (unmatched.length > 0) {
    const openIdx = lines.findIndex((line) => line.trim() === FRONTMATTER_DELIMITER);
    const at = openIdx === -1 ? 0 : openIdx;
    insertBefore.set(at, [...(insertBefore.get(at) ?? []), ...unmatched]);
  }

  const result: string[] = [];
  lines.forEach((line, idx) => {
    const pending = insertBefore.get(idx);
    if (pending) result.push(...pending);
    result.push(line);
  });

  return [...result, ...body].join('\n');
}
