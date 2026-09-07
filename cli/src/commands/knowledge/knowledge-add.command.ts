import { Optional } from '@nestjs/common';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { EditorService } from '../../core/editor/editor.service';
import { buildTemplate } from '../../core/editor/template';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import { keyBackedField, mapKeyBackedFields } from '../../core/resolve/key-backed-submit';
import { KEY_BACKED_FIELDS, VocabularyIndex } from '../../core/resolve/vocabulary';
import { KNOWLEDGE_CREATE_SCHEMA, KNOWLEDGE_TEMPLATE_HEADER, type KnowledgeRecord } from './knowledge.helpers';

interface AddOptions {
  profile?: string;
  api?: string;
  /**
   * Three states via commander's dual-option support (`--edit` registered
   * before `--no-edit` in this class so its presence suppresses the
   * negate-implied default — see command-runner.service.js's addOption):
   * `undefined` (neither flag), `true` (--edit), `false` (--no-edit).
   */
  edit?: boolean;
  title?: string;
  slug?: string;
  summary?: string;
  body?: string;
  format?: string;
  /** A knowledge type key or a raw UUID -- resolved the same way the buffer's `type` field is. */
  type?: string;
  /** A category key or a raw UUID -- resolved the same way the buffer's `category` field is. */
  category?: string;
  visibility?: string;
  sourceUrl?: string;
  sourceFileId?: string;
  language?: string;
  reviewDueAt?: string;
  expiresAt?: string;
  /** Comma-separated tag keys or raw UUIDs -- resolved the same way the buffer's `tags` field is. */
  tags?: string;
}

const FIELD_OPTION_KEYS: (keyof AddOptions)[] = [
  'title',
  'slug',
  'summary',
  'body',
  'format',
  'type',
  'category',
  'visibility',
  'sourceUrl',
  'sourceFileId',
  'language',
  'reviewDueAt',
  'expiresAt',
  'tags',
];

@SubCommand({ name: 'add', description: 'Create a knowledge record' })
export class KnowledgeAddCommand extends CommandRunner {
  constructor(
    private readonly settings: SettingsService,
    private readonly clients: ClientFactory,
    @Optional() private readonly editor: EditorService = new EditorService(),
  ) {
    super();
  }

  @Option({ flags: '-p, --profile <name>', description: 'Profile to use' })
  parseProfile(v: string): string {
    return v;
  }

  @Option({ flags: '--api <url>', description: 'Override the API base URL' })
  parseApi(v: string): string {
    return v;
  }

  // Declaration order matters: --edit must be registered before --no-edit so
  // commander's addOption() sees the positive counterpart already exists and
  // skips forcing the negate-implied default of `true` (see AddOptions.edit).
  @Option({ flags: '--edit', description: 'Force opening the editor even when field flags are given' })
  parseEdit(): boolean {
    return true;
  }

  // commander calls this for the negate flag regardless of nest-commander's
  // usual "just return true" idiom — it uses the handler's return value as
  // the option's value verbatim, so a negate option's handler must actually
  // return `false`, or `--no-edit` would set `edit` to `true` like every
  // other boolean flag in this codebase (confirmed empirically: nest-commander
  // always attaches an argParser, which commander then always consults).
  @Option({ flags: '--no-edit', description: 'Never open the editor; use field flags only' })
  parseNoEdit(): boolean {
    return false;
  }

  @Option({ flags: '--title <text>', description: 'Record title' })
  parseTitle(v: string): string {
    return v;
  }

  @Option({ flags: '--slug <slug>', description: 'Record slug (derived from title if omitted)' })
  parseSlug(v: string): string {
    return v;
  }

  @Option({ flags: '--summary <text>', description: 'Short summary' })
  parseSummary(v: string): string {
    return v;
  }

  @Option({ flags: '--body <text>', description: 'Article body' })
  parseBody(v: string): string {
    return v;
  }

  @Option({ flags: '--format <format>', description: 'markdown|html|plain|link|file' })
  parseFormat(v: string): string {
    return v;
  }

  @Option({ flags: '--type <key-or-uuid>', description: 'Knowledge type key or id -- see: cyb knowledge type ls' })
  parseType(v: string): string {
    return v;
  }

  @Option({ flags: '--category <key-or-uuid>', description: 'Category key or id -- see: cyb knowledge category ls' })
  parseCategory(v: string): string {
    return v;
  }

  @Option({ flags: '--visibility <visibility>', description: 'private|restricted|internal' })
  parseVisibility(v: string): string {
    return v;
  }

  @Option({ flags: '--source-url <url>', description: 'Source URL' })
  parseSourceUrl(v: string): string {
    return v;
  }

  @Option({ flags: '--source-file-id <uuid>', description: 'Source file id' })
  parseSourceFileId(v: string): string {
    return v;
  }

  @Option({ flags: '--language <lang>', description: 'Language code (default en)' })
  parseLanguage(v: string): string {
    return v;
  }

  @Option({ flags: '--review-due-at <date>', description: 'ISO date/timestamp' })
  parseReviewDueAt(v: string): string {
    return v;
  }

  @Option({ flags: '--expires-at <date>', description: 'ISO date/timestamp' })
  parseExpiresAt(v: string): string {
    return v;
  }

  @Option({ flags: '--tags <keys-or-uuids>', description: 'Comma-separated tag keys or ids -- see: cyb tags ls' })
  parseTags(v: string): string {
    return v;
  }

  async run(_params: string[], options: AddOptions): Promise<void> {
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);
    // One VocabularyIndex per invocation (design spec §3), shared across
    // every key-backed field on both the editor and the flag-only path
    // below.
    const vocab = new VocabularyIndex(client);

    const fieldFlagsGiven = FIELD_OPTION_KEYS.some((key) => options[key] !== undefined);
    const wantsEditor = options.edit === true || (options.edit !== false && !fieldFlagsGiven);

    if (!wantsEditor && !fieldFlagsGiven) {
      throw new UsageError(
        'No fields given and --no-edit forbids the editor. Pass --title (and others), or drop --no-edit.',
      );
    }

    const create = async (dto: Record<string, unknown>): Promise<void> => {
      const created = await client.post<KnowledgeRecord>('/knowledge', dto);
      process.stdout.write(`Created "${created.slug}" (${created.id}).\n`);
    };

    if (wantsEditor) {
      const initial = buildTemplate({
        schema: KNOWLEDGE_CREATE_SCHEMA,
        bodyField: 'body',
        header: KNOWLEDGE_TEMPLATE_HEADER,
        keyBacked: KEY_BACKED_FIELDS.knowledge,
      });
      await this.editor.run({
        initial,
        filetype: 'md',
        submit: async (doc) => {
          const dto: Record<string, unknown> = { ...doc.fields };
          // Renames each key-backed buffer field (type/category/tags) to its
          // DTO id field, resolved through the shared vocab. A bad key here
          // surfaces as an ApiError with an issue naming the buffer field
          // (see key-backed-submit.ts), which EditorService's retry loop
          // annotates back into the buffer instead of crashing.
          await mapKeyBackedFields(KEY_BACKED_FIELDS.knowledge, dto, vocab);
          if (doc.body) dto.body = doc.body;
          await create(dto);
        },
      });
      return;
    }

    if (options.title === undefined) {
      throw new UsageError('--title is required when creating without the editor.');
    }

    const dto: Record<string, unknown> = { title: options.title };
    if (options.slug !== undefined) dto.slug = options.slug;
    if (options.summary !== undefined) dto.summary = options.summary;
    if (options.body !== undefined) dto.body = options.body;
    if (options.format !== undefined) dto.format = options.format;
    // A UsageError here (unknown key) has no buffer to annotate, so it
    // propagates as itself -- ordinary exit 2, unlike the editor path above.
    if (options.type !== undefined) {
      dto.typeId = await vocab.toId(keyBackedField(KEY_BACKED_FIELDS.knowledge, 'type'), options.type);
    }
    if (options.category !== undefined) {
      dto.categoryId = await vocab.toId(keyBackedField(KEY_BACKED_FIELDS.knowledge, 'category'), options.category);
    }
    if (options.visibility !== undefined) dto.visibility = options.visibility;
    if (options.sourceUrl !== undefined) dto.sourceUrl = options.sourceUrl;
    if (options.sourceFileId !== undefined) dto.sourceFileId = options.sourceFileId;
    if (options.language !== undefined) dto.language = options.language;
    if (options.reviewDueAt !== undefined) dto.reviewDueAt = options.reviewDueAt;
    if (options.expiresAt !== undefined) dto.expiresAt = options.expiresAt;
    if (options.tags !== undefined) {
      const keys = options.tags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      dto.tagIds = await vocab.toIds(keyBackedField(KEY_BACKED_FIELDS.knowledge, 'tags'), keys);
    }

    await create(dto);
  }
}
