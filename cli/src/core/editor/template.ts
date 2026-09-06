import { stringify as stringifyYaml } from 'yaml';

export interface TemplateOptions {
  /** JSON Schema for the request DTO, from `src/generated/schemas.ts`. */
  schema: unknown;
  /** Existing record for an edit; omit/null for a create. */
  current?: Record<string, unknown> | null;
  /** Field whose value becomes the markdown body (e.g. 'body' for knowledge). */
  bodyField?: string;
  /** Header comment lines placed above the frontmatter. */
  header?: string[];
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

/** Fields the template rendered, so the diff step knows what the user could change. */
export function templateFields(schema: unknown, bodyField?: string): string[] {
  const properties = asSchema(schema).properties ?? {};
  const keys = Object.keys(properties);

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
