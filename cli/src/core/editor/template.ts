import { stringify as stringifyYaml } from 'yaml';
import type { KeyBackedField } from '../resolve/vocabulary';

export interface TemplateOptions {
  /** JSON Schema for the request DTO, from `src/generated/schemas.ts`. */
  schema: unknown;
  /** Existing record for an edit; omit/null for a create. */
  current?: Record<string, unknown> | null;
  /** Field whose value becomes the markdown body (e.g. 'body' for knowledge). */
  bodyField?: string;
  /** Header comment lines placed above the frontmatter. */
  header?: string[];
  /**
   * Buffer fields that carry vocabulary keys instead of raw DTO ids, from
   * `KEY_BACKED_FIELDS` (`core/resolve/vocabulary.ts`, Task 1). For each
   * entry, the schema property named `dtoField` renders instead under
   * `bufferField`.
   *
   * `buildTemplate` does no HTTP and stays synchronous: on an edit, the
   * caller must already have resolved the id to a key (via
   * `VocabularyIndex.toKey`/`toKeys`) and placed it at
   * `current[bufferField]` -- `current[dtoField]` (the raw id) is never
   * read for a listed field. This is a deliberate departure from an
   * injected-async-resolver design: it keeps this module's ~19 other call
   * sites (which never pass `keyBacked`) untouched, rather than making every
   * one of them `await` a capability only two callers use. See
   * `commands/contacts/contacts.helpers.ts` and
   * `commands/knowledge/knowledge.helpers.ts` for where the actual
   * (async, HTTP-backed) resolution happens.
   */
  keyBacked?: KeyBackedField[];
}

interface JsonSchemaLike {
  type?: string;
  properties?: Record<string, JsonSchemaLike>;
  required?: string[];
  enum?: unknown[];
  maxLength?: number;
  format?: string;
  default?: unknown;
}

function asSchema(schema: unknown): JsonSchemaLike {
  return (schema ?? {}) as JsonSchemaLike;
}

/**
 * Fields the template rendered, so the diff step knows what the user could
 * change. When `keyBacked` is given, a listed schema property is reported
 * under its `bufferField` name, not its `dtoField` name -- the diff step
 * (Task 5) compares against what the user actually sees in the buffer.
 */
export function templateFields(schema: unknown, bodyField?: string, keyBacked?: KeyBackedField[]): string[] {
  const properties = asSchema(schema).properties ?? {};
  const dtoToBuffer = new Map((keyBacked ?? []).map((field) => [field.dtoField, field.bufferField]));
  const keys = Object.keys(properties).map((key) => dtoToBuffer.get(key) ?? key);

  if (bodyField && !keys.includes(bodyField)) {
    return [...keys, bodyField];
  }
  return keys;
}

/** Facts derived from a field's schema, in the order they're documented. */
function schemaFacts(fieldSchema: JsonSchemaLike): string[] {
  const facts: string[] = [];

  if (fieldSchema.enum && fieldSchema.enum.length > 0) {
    facts.push(fieldSchema.enum.join('|'));
  }
  if (typeof fieldSchema.maxLength === 'number') {
    facts.push(`max ${fieldSchema.maxLength}`);
  }
  if (fieldSchema.format) {
    facts.push(fieldSchema.format);
  }
  if (fieldSchema.default !== undefined) {
    facts.push(`default ${fieldSchema.default}`);
  }
  return facts;
}

/**
 * `date-time` values render as a bare `YYYY-MM-DD` when the time is exactly
 * midnight UTC, else full ISO. Both round-trip through the API's
 * `z.coerce.date()`. Values that aren't parseable dates pass through as-is.
 */
function formatDateTimeValue(raw: unknown): unknown {
  if (raw === null || raw === undefined) return raw;
  const date = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(date.getTime())) return raw;

  const iso = date.toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
}

/** The value that fills an unset field's slot, based on its declared type. */
function emptyValueFor(fieldSchema: JsonSchemaLike): unknown {
  switch (fieldSchema.type) {
    case 'array':
      return [];
    case 'object':
      return {};
    case 'string':
      return '';
    default:
      return null;
  }
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return '';
  return stringifyYaml(value, { flow: true }).trim();
}

/** Renders one `key: value  # facts` frontmatter line, optionally commented out. */
function renderFieldLine(key: string, value: unknown, fieldSchema: JsonSchemaLike, commentedOut: boolean): string {
  const formatted = formatScalar(value);
  const facts = schemaFacts(fieldSchema);

  let line = `${key}:`;
  if (formatted !== '') line += ` ${formatted}`;
  if (facts.length > 0) line += `  # ${facts.join(', ')}`;

  return commentedOut ? `# ${line}` : line;
}

/**
 * The `ls` command that lists every valid key for `field`'s kind -- named in
 * the field's comment because a generated comment can't list a whole
 * vocabulary itself (design spec §8; the full list belongs in
 * `VocabularyIndex`'s error, where it's actually needed).
 *
 * Mirrors the ls-command strings inside `core/resolve/vocabulary.ts`'s
 * `BOUNDED_CONFIGS` and its tag-scope error text -- that module is out of
 * bounds for this task, so this is a deliberate, small duplication, the same
 * pattern as `knowledge.helpers.ts`'s `normalizeDateTimeForCompare` mirroring
 * this file's own `formatDateTimeValue`. Keep in sync by hand.
 */
function lsCommand(field: KeyBackedField): string {
  switch (field.kind) {
    case 'contact-type':
      return 'cyb contacts type ls';
    case 'contact-category':
      return 'cyb contacts category ls';
    case 'knowledge-type':
      return 'cyb knowledge type ls';
    case 'knowledge-category':
      return 'cyb knowledge category ls';
    case 'tag':
      return `cyb tags ls --scope ${field.scope}`;
    case 'company':
      return 'cyb companies ls';
  }
}

/**
 * Renders a key-backed field's frontmatter line under its `bufferField`
 * name. On create there is no id to resolve yet, so it renders empty
 * (commented out, like any other optional field) with a comment naming its
 * kind and the command that lists valid keys. On edit, the value comes from
 * `current[bufferField]` -- already resolved to a key by the caller
 * (`VocabularyIndex.toKey`/`toKeys`), or the raw id verbatim when
 * unresolvable (that fallback is `VocabularyIndex.toKey`'s job, not this
 * function's -- it renders whatever it's handed).
 */
function renderKeyBackedLine(field: KeyBackedField, current: Record<string, unknown> | null | undefined, isEdit: boolean): string {
  const emptyValue = field.many ? [] : null;
  const value = isEdit
    ? current && field.bufferField in current
      ? current[field.bufferField]
      : emptyValue
    : emptyValue;

  const noun = field.many ? 'keys' : 'key';
  const formatted = formatScalar(value);

  let line = `${field.bufferField}:`;
  if (formatted !== '') line += ` ${formatted}`;
  line += `  # ${noun} — see: ${lsCommand(field)}`;

  return isEdit ? line : `# ${line}`;
}

/**
 * Builds an annotated editor buffer from a JSON Schema and (optionally) the
 * current record. On a create, required fields are uncommented and optional
 * fields are commented out so the buffer doubles as documentation; on an
 * edit, every field the schema accepts is uncommented and populated.
 */
export function buildTemplate(opts: TemplateOptions): string {
  const schema = asSchema(opts.schema);
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const isEdit = opts.current != null;
  const keyBackedByDtoField = new Map((opts.keyBacked ?? []).map((field) => [field.dtoField, field]));

  const headerBlock =
    opts.header && opts.header.length > 0
      ? opts.header.map((line) => (line.length > 0 ? `# ${line}` : '#')).join('\n') + '\n'
      : '';

  const fieldLines: string[] = [];
  let body = '';

  for (const [key, fieldSchemaRaw] of Object.entries(properties)) {
    const fieldSchema = fieldSchemaRaw ?? {};

    if (key === opts.bodyField) {
      const raw = opts.current?.[key];
      body = typeof raw === 'string' ? raw : '';
      continue;
    }

    const keyBackedField = keyBackedByDtoField.get(key);
    if (keyBackedField) {
      fieldLines.push(renderKeyBackedLine(keyBackedField, opts.current, isEdit));
      continue;
    }

    const defaultOrEmpty =
      fieldSchema.default !== undefined ? fieldSchema.default : emptyValueFor(fieldSchema);

    let value: unknown;
    let commentedOut: boolean;

    if (isEdit) {
      value = opts.current && key in opts.current ? opts.current[key] : emptyValueFor(fieldSchema);
      commentedOut = false;
    } else {
      value = defaultOrEmpty;
      commentedOut = !required.has(key);
    }

    if (fieldSchema.format === 'date-time') {
      value = formatDateTimeValue(value);
    }

    fieldLines.push(renderFieldLine(key, value, fieldSchema, commentedOut));
  }

  const yamlBlock = fieldLines.length > 0 ? fieldLines.join('\n') + '\n' : '';

  return `${headerBlock}---\n${yamlBlock}---\n\n${body}`;
}
