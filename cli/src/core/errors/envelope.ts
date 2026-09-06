import { ApiError, type ApiIssue } from './api-error';

interface EnvelopeShape {
  error: {
    code: string;
    message: string;
    statusCode: number;
    details: unknown;
    correlationId: string;
    timestamp: string;
    path: string;
  };
}

function isEnvelope(body: unknown): body is EnvelopeShape {
  if (typeof body !== 'object' || body === null) return false;
  const err = (body as { error?: unknown }).error;
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { code?: unknown }).code === 'string'
  );
}

/**
 * The API sends each issue's `path` as a single joined STRING —
 * `issue.path.join('.') || '(root)'` in
 * api/src/common/pipes/zod-validation.pipe.ts and
 * api/src/infrastructure/exceptions/exception.service.ts — never an array.
 * `ApiIssue.path` stays typed as `(string | number)[]` because `annotate()`
 * and `reportError` already key off that shape; this is the one place that
 * normalizes to it, so nothing downstream has to know two shapes exist.
 *
 * Splitting a string on `.` recovers `annotate`'s per-field anchor
 * (`'tagIds.0'` -> `['tagIds', '0']`, still anchoring on `tagIds`) and
 * happens to do the right thing for the API's `'(root)'` sentinel too — a
 * cross-field `.refine()` with no single offending key — since it contains
 * no `.` and survives as a single segment. No real frontmatter field is
 * named `(root)`, so it can never match one and always lands in
 * `annotate`'s unmatched header block instead of misattaching to a field.
 *
 * An array path (what a future or differently-shaped endpoint might send,
 * and what earlier hand-written tests exercised) is kept exactly as-is.
 */
function normalizeIssuePath(path: unknown): (string | number)[] | null {
  if (Array.isArray(path)) return path as (string | number)[];
  if (typeof path === 'string') return path.split('.');
  return null;
}

function toIssue(raw: unknown): ApiIssue | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const message = (raw as { message?: unknown }).message;
  if (typeof message !== 'string') return null;
  const path = normalizeIssuePath((raw as { path?: unknown }).path);
  if (path === null) return null;
  return { path, message };
}

function issuesFrom(details: unknown): ApiIssue[] {
  if (typeof details !== 'object' || details === null) return [];
  const issues = (details as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];
  return issues
    .map(toIssue)
    .filter((issue): issue is ApiIssue => issue !== null);
}

/**
 * Turns any error response into an ApiError.
 *
 * A gateway or proxy can answer with HTML rather than the API's envelope, so
 * the UNKNOWN fallback is a normal path, not a defensive flourish.
 */
export function parseErrorEnvelope(status: number, body: unknown): ApiError {
  if (!isEnvelope(body)) {
    return new ApiError(status, 'UNKNOWN', `Request failed with status ${status}`);
  }
  const { code, message, details, correlationId } = body.error;
  return new ApiError(status, code, message, issuesFrom(details), correlationId);
}
