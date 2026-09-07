import { Optional } from '@nestjs/common';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { EditorService } from '../../core/editor/editor.service';
import { buildTemplate } from '../../core/editor/template';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import { keyBackedField, mapKeyBackedFields } from '../../core/resolve/key-backed-submit';
import { KEY_BACKED_FIELDS, VocabularyIndex } from '../../core/resolve/vocabulary';
import { CONTACTS_CREATE_SCHEMA, CONTACTS_TEMPLATE_HEADER, type ContactRecord } from './contacts.helpers';

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
  firstName?: string;
  lastName?: string;
  displayName?: string;
  salutation?: string;
  primaryEmail?: string;
  primaryPhone?: string;
  jobTitle?: string;
  /** A company name or a raw UUID -- resolved the same way the buffer's `company` field is. */
  company?: string;
  /** A contact type key or a raw UUID -- resolved the same way the buffer's `type` field is. */
  type?: string;
  /** A category key or a raw UUID -- resolved the same way the buffer's `category` field is. */
  category?: string;
  status?: string;
  source?: string;
  visibility?: string;
  country?: string;
  timezone?: string;
  language?: string;
  birthday?: string;
  notes?: string;
  nextFollowUpAt?: string;
  /** Comma-separated tag keys or raw UUIDs -- resolved the same way the buffer's `tags` field is. */
  tags?: string;
}

const FIELD_OPTION_KEYS: (keyof AddOptions)[] = [
  'firstName',
  'lastName',
  'displayName',
  'salutation',
  'primaryEmail',
  'primaryPhone',
  'jobTitle',
  'company',
  'type',
  'category',
  'status',
  'source',
  'visibility',
  'country',
  'timezone',
  'language',
  'birthday',
  'notes',
  'nextFollowUpAt',
  'tags',
];

@SubCommand({ name: 'add', description: 'Create a contact' })
export class ContactsAddCommand extends CommandRunner {
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
  // other boolean flag in this codebase.
  @Option({ flags: '--no-edit', description: 'Never open the editor; use field flags only' })
  parseNoEdit(): boolean {
    return false;
  }

  @Option({ flags: '--first-name <text>', description: 'First name' })
  parseFirstName(v: string): string {
    return v;
  }

  @Option({ flags: '--last-name <text>', description: 'Last name' })
  parseLastName(v: string): string {
    return v;
  }

  @Option({ flags: '--display-name <text>', description: 'Display name (derived from name/email if omitted)' })
  parseDisplayName(v: string): string {
    return v;
  }

  @Option({ flags: '--salutation <text>', description: 'Salutation' })
  parseSalutation(v: string): string {
    return v;
  }

  @Option({ flags: '--primary-email <email>', description: 'Primary email address' })
  parsePrimaryEmail(v: string): string {
    return v;
  }

  @Option({ flags: '--primary-phone <text>', description: 'Primary phone number' })
  parsePrimaryPhone(v: string): string {
    return v;
  }

  @Option({ flags: '--job-title <text>', description: 'Job title' })
  parseJobTitle(v: string): string {
    return v;
  }

  @Option({ flags: '--company <key-or-uuid>', description: 'Company name or id -- see: cyb companies ls' })
  parseCompany(v: string): string {
    return v;
  }

  @Option({ flags: '--type <key-or-uuid>', description: 'Contact type key or id -- see: cyb contacts type ls' })
  parseType(v: string): string {
    return v;
  }

  @Option({ flags: '--category <key-or-uuid>', description: 'Category key or id -- see: cyb contacts category ls' })
  parseCategory(v: string): string {
    return v;
  }

  @Option({ flags: '--status <status>', description: 'active|inactive|archived|do_not_contact (default active)' })
  parseStatus(v: string): string {
    return v;
  }

  @Option({ flags: '--source <source>', description: 'manual|inbound_email|import|referral|website|agent (default manual)' })
  parseSource(v: string): string {
    return v;
  }

  @Option({ flags: '--visibility <visibility>', description: 'private|shared (default private)' })
  parseVisibility(v: string): string {
    return v;
  }

  @Option({ flags: '--country <code>', description: 'Two-letter country code' })
  parseCountry(v: string): string {
    return v;
  }

  @Option({ flags: '--timezone <tz>', description: 'Timezone' })
  parseTimezone(v: string): string {
    return v;
  }

  @Option({ flags: '--language <lang>', description: 'Language code' })
  parseLanguage(v: string): string {
    return v;
  }

  @Option({ flags: '--birthday <date>', description: 'ISO date' })
  parseBirthday(v: string): string {
    return v;
  }

  @Option({ flags: '--notes <text>', description: 'Notes' })
  parseNotes(v: string): string {
    return v;
  }

  @Option({ flags: '--next-follow-up-at <date>', description: 'ISO date/timestamp' })
  parseNextFollowUpAt(v: string): string {
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
    // below, so e.g. two fields of the same bounded kind cost one fetch.
    const vocab = new VocabularyIndex(client);

    const fieldFlagsGiven = FIELD_OPTION_KEYS.some((key) => options[key] !== undefined);
    const wantsEditor = options.edit === true || (options.edit !== false && !fieldFlagsGiven);

    if (!wantsEditor && !fieldFlagsGiven) {
      throw new UsageError(
        'No fields given and --no-edit forbids the editor. Pass --display-name (and others), or drop --no-edit.',
      );
    }

    const create = async (dto: Record<string, unknown>): Promise<void> => {
      const created = await client.post<ContactRecord>('/contacts', dto);
      process.stdout.write(`Created "${created.displayName}" (${created.id}).\n`);
    };

    if (wantsEditor) {
      const initial = buildTemplate({
        schema: CONTACTS_CREATE_SCHEMA,
        bodyField: 'notes',
        header: CONTACTS_TEMPLATE_HEADER,
        keyBacked: KEY_BACKED_FIELDS.contact,
      });
      await this.editor.run({
        initial,
        filetype: 'md',
        submit: async (doc) => {
          const dto: Record<string, unknown> = { ...doc.fields };
          // Renames each key-backed buffer field (type/category/tags/company)
          // to its DTO id field, resolved through the shared vocab. A bad key
          // here surfaces as an ApiError with an issue naming the buffer
          // field (see key-backed-submit.ts), which EditorService's retry
          // loop annotates back into the buffer instead of crashing.
          await mapKeyBackedFields(KEY_BACKED_FIELDS.contact, dto, vocab);
          if (doc.body) dto.notes = doc.body;
          await create(dto);
        },
      });
      return;
    }

    // Unlike knowledge (`title` is JSON-Schema-required), CreateContactDto has
    // no `required` array at all — its "name or email" rule is a cross-field
    // `.refine()` that doesn't survive to JSON Schema (see contacts.helpers.ts
    // and CONTACTS_TEMPLATE_HEADER). So there is nothing to pre-check here:
    // a flag combination that violates it goes to the server and comes back
    // as a plain (uncaught, un-retried) 400 — flag mode never opens an
    // editor to retry into, unlike the editor path.
    const dto: Record<string, unknown> = {};
    if (options.firstName !== undefined) dto.firstName = options.firstName;
    if (options.lastName !== undefined) dto.lastName = options.lastName;
    if (options.displayName !== undefined) dto.displayName = options.displayName;
    if (options.salutation !== undefined) dto.salutation = options.salutation;
    if (options.primaryEmail !== undefined) dto.primaryEmail = options.primaryEmail;
    if (options.primaryPhone !== undefined) dto.primaryPhone = options.primaryPhone;
    if (options.jobTitle !== undefined) dto.jobTitle = options.jobTitle;
    // A UsageError here (unknown key) has no buffer to annotate, so it
    // propagates as itself -- ordinary exit 2, unlike the editor path above.
    if (options.company !== undefined) {
      dto.companyId = await vocab.toId(keyBackedField(KEY_BACKED_FIELDS.contact, 'company'), options.company);
    }
    if (options.type !== undefined) {
      dto.typeId = await vocab.toId(keyBackedField(KEY_BACKED_FIELDS.contact, 'type'), options.type);
    }
    if (options.category !== undefined) {
      dto.categoryId = await vocab.toId(keyBackedField(KEY_BACKED_FIELDS.contact, 'category'), options.category);
    }
    if (options.status !== undefined) dto.status = options.status;
    if (options.source !== undefined) dto.source = options.source;
    if (options.visibility !== undefined) dto.visibility = options.visibility;
    if (options.country !== undefined) dto.country = options.country;
    if (options.timezone !== undefined) dto.timezone = options.timezone;
    if (options.language !== undefined) dto.language = options.language;
    if (options.birthday !== undefined) dto.birthday = options.birthday;
    if (options.notes !== undefined) dto.notes = options.notes;
    if (options.nextFollowUpAt !== undefined) dto.nextFollowUpAt = options.nextFollowUpAt;
    if (options.tags !== undefined) {
      const keys = options.tags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      dto.tagIds = await vocab.toIds(keyBackedField(KEY_BACKED_FIELDS.contact, 'tags'), keys);
    }

    await create(dto);
  }
}
