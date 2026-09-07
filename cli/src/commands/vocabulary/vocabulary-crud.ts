import type { SettingsService } from '../../core/config/settings.service';
import type { EditorDocument } from '../../core/editor/frontmatter';
import type { EditorService } from '../../core/editor/editor.service';
import { buildTemplate, templateFields } from '../../core/editor/template';
import { UsageError } from '../../core/errors';
import type { ClientFactory } from '../../core/http/client.factory';
import { renderTable } from '../../core/render/table';

/**
 * `contacts type`, `contacts category`, `knowledge type` and `knowledge
 * category` are the same CRUD shape over four endpoint sets (see
 * ContactVocabularyController/KnowledgeVocabularyController in the API) —
 * this module is the ONE implementation of that shape, parameterised by
 * `VocabConfig`. Each of the four groups (contacts.helpers.ts,
 * knowledge.helpers.ts) supplies its own config and a handful of thin,
 * genuinely-distinct nest-commander classes that delegate straight into the
 * functions below — see contacts-type.command.ts for the pattern.
 *
 * Command classes stay distinct (rather than one dynamically-generated class
 * reused four times) because nest-commander's `CommandRunnerService` matches
 * a parent's `subCommands` entries against globally-discovered providers by
 * **class name string**, not by object identity (confirmed against
 * `command-runner.service.js`): `subCommand.name` is compared against every
 * `@SubCommand`-tagged provider in the whole app. Four command objects all
 * literally named e.g. `VocabularyLsCommand` would collide across groups.
 */

export type ConfirmPrompt = (message: string) => Promise<boolean>;

/**
 * One record shape shared by contact/knowledge types and categories — the
 * fields `ls`'s table and `add`'s common flags read directly. Each concrete
 * vocabulary's row carries more (color, icon, parentId, isSystem, ...), but
 * this module only ever reads `id`/`key`/`name`/`description` by name; the
 * rest passes untouched through the schema-driven editor buffer.
 */
export interface VocabRecord {
  id: string;
  key: string;
  name: string;
  description: string | null;
  [extra: string]: unknown;
}

/**
 * THE single declaration each of the four groups instantiates against — see
 * `CONTACT_TYPE_VOCAB_CONFIG` etc. in contacts.helpers.ts/knowledge.helpers.ts.
 */
export interface VocabConfig {
  /** Human label used in messages, e.g. 'contact type'. */
  label: string;
  /** `GET` lists, `POST` creates; `PATCH`/`DELETE` `${basePath}/{id}` edit/remove. */
  basePath: string;
  /** `CreateXDto`'s JSON Schema, from `src/generated/schemas.ts`. */
  createSchema: unknown;
  /** `UpdateXDto`'s JSON Schema. */
  updateSchema: unknown;
  /**
   * Extra lines shown above the editor buffer's frontmatter, for facts the
   * schema alone can't carry (e.g. category depth/cycle rules). Most groups
   * need none.
   */
  header?: string[];
}

export interface VocabCommonOptions {
  profile?: string;
  api?: string;
}

// --- ls ---

export interface VocabLsOptions extends VocabCommonOptions {
  json?: boolean;
}

export async function runVocabularyLs(
  config: VocabConfig,
  settings: SettingsService,
  clients: ClientFactory,
  options: VocabLsOptions,
): Promise<void> {
  const resolved = settings.resolve(options);
  const client = clients.create(resolved);

  // Not paginated: every one of {Contact,Knowledge}VocabularyController's
  // list* methods takes no query params and returns a plain array (confirmed
  // against operations.ts and the service implementations — e.g.
  // ContactVocabularyService.listTypes()).
  const records = await client.get<VocabRecord[]>(config.basePath);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);
    return;
  }

  if (records.length === 0) {
    process.stdout.write(`No ${config.label}s.\n`);
    return;
  }

  const table = renderTable(records, [
    // Full id: retyped verbatim into `edit`/`rm`, and (once Task 5 wires the
    // submit path) into buffer fields.
    { header: 'ID', value: (r) => r.id },
    { header: 'KEY', value: (r) => r.key },
    { header: 'NAME', value: (r) => r.name },
    { header: 'DESCRIPTION', value: (r) => r.description ?? '' },
  ]);
  process.stdout.write(`${table}\n`);
}

// --- add ---

/**
 * `--key`/`--name`/`--description`/`--sort-order` are the fields every one
 * of the four create DTOs shares (confirmed against schemas.ts:
 * `CreateContactTypeDto`, `CreateCategoryDto`, `CreateKnowledgeTypeDto` all
 * carry these four, plus one field each doesn't share with the others —
 * `color`, `parentId`, `icon`/`color`/`defaultReviewIntervalDays`). Those
 * extras are reachable only through the editor, which renders every field
 * the schema declares; adding per-group flags for them would mean four
 * different option sets and defeat sharing one implementation.
 */
export interface VocabAddOptions extends VocabCommonOptions {
  edit?: boolean;
  key?: string;
  name?: string;
  description?: string;
  sortOrder?: number;
}

const ADD_FIELD_KEYS: (keyof VocabAddOptions)[] = ['key', 'name', 'description', 'sortOrder'];

export async function runVocabularyAdd(
  config: VocabConfig,
  settings: SettingsService,
  clients: ClientFactory,
  editor: EditorService,
  options: VocabAddOptions,
): Promise<void> {
  const resolved = settings.resolve(options);
  const client = clients.create(resolved);

  const fieldFlagsGiven = ADD_FIELD_KEYS.some((key) => options[key] !== undefined);
  const wantsEditor = options.edit === true || (options.edit !== false && !fieldFlagsGiven);

  if (!wantsEditor && !fieldFlagsGiven) {
    throw new UsageError(
      'No fields given and --no-edit forbids the editor. Pass --key and --name (and others), or drop --no-edit.',
    );
  }

  const create = async (dto: Record<string, unknown>): Promise<void> => {
    const created = await client.post<VocabRecord>(config.basePath, dto);
    process.stdout.write(`Created ${config.label} "${created.key}" (${created.id}).\n`);
  };

  if (wantsEditor) {
    const initial = buildTemplate({ schema: config.createSchema, header: config.header });
    await editor.run({
      initial,
      filetype: 'md',
      submit: async (doc) => {
        await create({ ...doc.fields });
      },
    });
    return;
  }

  if (options.key === undefined) throw new UsageError('--key is required.');
  if (options.name === undefined) throw new UsageError('--name is required.');

  const dto: Record<string, unknown> = { key: options.key, name: options.name };
  if (options.description !== undefined) dto.description = options.description;
  if (options.sortOrder !== undefined) dto.sortOrder = options.sortOrder;

  await create(dto);
}

// --- edit ---

function toEditableFields(record: VocabRecord, schema: unknown): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const key of templateFields(schema)) {
    fields[key] = key in record ? record[key] : null;
  }
  return fields;
}

/** Diffs the submitted document against the fetched record, field by field, returning only what changed. */
function buildVocabPatch(record: VocabRecord, schema: unknown, doc: EditorDocument): Record<string, unknown> {
  const fields = templateFields(schema);
  const before = toEditableFields(record, schema);
  const patch: Record<string, unknown> = {};

  for (const key of fields) {
    const beforeValue = before[key] ?? null;
    const afterValue = key in doc.fields ? doc.fields[key] : null;

    if (JSON.stringify(beforeValue ?? null) !== JSON.stringify(afterValue ?? null)) {
      patch[key] = key in doc.fields ? doc.fields[key] : null;
    }
  }

  return patch;
}

export async function runVocabularyEdit(
  config: VocabConfig,
  settings: SettingsService,
  clients: ClientFactory,
  editor: EditorService,
  id: string,
  options: VocabCommonOptions,
): Promise<void> {
  const resolved = settings.resolve(options);
  const client = clients.create(resolved);

  // No single-record GET exists on any of the four *VocabularyController*s
  // (confirmed against operations.ts) — only list, create, update, remove —
  // so the current record for the edit buffer comes from the list, matched
  // by id, the same shape ProjectsMilestoneEditCommand uses for milestones.
  const records = await client.get<VocabRecord[]>(config.basePath);
  const record = records.find((r) => r.id === id);
  if (!record) {
    throw new UsageError(`No ${config.label} matches "${id}".`);
  }

  await editor.run({
    initial: buildTemplate({
      schema: config.updateSchema,
      current: toEditableFields(record, config.updateSchema),
      header: config.header,
    }),
    filetype: 'md',
    submit: async (doc) => {
      const patch = buildVocabPatch(record, config.updateSchema, doc);

      if (Object.keys(patch).length === 0) {
        process.stdout.write('No changes to save.\n');
        return;
      }

      const updated = await client.patch<VocabRecord>(`${config.basePath}/${id}`, patch);
      process.stdout.write(`Updated ${config.label} "${updated.name}".\n`);
    },
  });
}

// --- rm ---

export interface VocabRmOptions extends VocabCommonOptions {
  yes?: boolean;
}

export async function runVocabularyRm(
  config: VocabConfig,
  settings: SettingsService,
  clients: ClientFactory,
  confirmPrompt: ConfirmPrompt,
  isTTY: () => boolean,
  id: string,
  options: VocabRmOptions,
): Promise<void> {
  const resolved = settings.resolve(options);
  const client = clients.create(resolved);

  const records = await client.get<VocabRecord[]>(config.basePath);
  const record = records.find((r) => r.id === id);
  if (!record) {
    throw new UsageError(`No ${config.label} matches "${id}".`);
  }

  if (!options.yes) {
    if (!isTTY()) {
      throw new UsageError(
        `Refusing to delete the ${config.label} "${record.name}" without --yes in a non-interactive session.`,
      );
    }
    const confirmed = await confirmPrompt(`Delete the ${config.label} "${record.name}"?`);
    if (!confirmed) {
      process.stdout.write('Aborted.\n');
      return;
    }
  }

  await client.del(`${config.basePath}/${id}`);
  process.stdout.write(`Deleted the ${config.label} "${record.name}".\n`);
}
