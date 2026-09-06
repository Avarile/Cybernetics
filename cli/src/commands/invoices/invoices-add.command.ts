import { Optional } from '@nestjs/common';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { EditorService } from '../../core/editor/editor.service';
import { buildTemplate } from '../../core/editor/template';
import { missingFlagsMessage } from '../../core/cli/flag-name';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import { INVOICE_CREATE_SCHEMA, INVOICE_TEMPLATE_HEADER, type InvoiceRecord } from './invoices.helpers';

interface AddOptions {
  profile?: string;
  api?: string;
  /** See ContactsAddCommand.parseEdit/parseNoEdit for why this is three-state. */
  edit?: boolean;
  contactId?: string;
  companyId?: string;
  projectId?: string;
  issueDate?: string;
  dueDate?: string;
  currency?: string;
  notes?: string;
  terms?: string;
}

const FIELD_OPTION_KEYS: (keyof AddOptions)[] = [
  'contactId',
  'companyId',
  'projectId',
  'issueDate',
  'dueDate',
  'currency',
  'notes',
  'terms',
];

@SubCommand({ name: 'add', description: 'Create a draft invoice' })
export class InvoicesAddCommand extends CommandRunner {
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

  @Option({ flags: '--edit', description: 'Force opening the editor even when field flags are given' })
  parseEdit(): boolean {
    return true;
  }

  // See ContactsAddCommand.parseNoEdit for why this must return `false`.
  @Option({ flags: '--no-edit', description: 'Never open the editor; use field flags only' })
  parseNoEdit(): boolean {
    return false;
  }

  @Option({ flags: '--contact-id <uuid>', description: 'Bill-to contact (or --company-id)' })
  parseContactId(v: string): string {
    return v;
  }

  @Option({ flags: '--company-id <uuid>', description: 'Bill-to company (or --contact-id)' })
  parseCompanyId(v: string): string {
    return v;
  }

  @Option({ flags: '--project-id <uuid>', description: 'Project id' })
  parseProjectId(v: string): string {
    return v;
  }

  @Option({ flags: '--issue-date <date>', description: 'YYYY-MM-DD' })
  parseIssueDate(v: string): string {
    return v;
  }

  @Option({ flags: '--due-date <date>', description: 'YYYY-MM-DD' })
  parseDueDate(v: string): string {
    return v;
  }

  @Option({ flags: '--currency <code>', description: 'Three-letter currency code' })
  parseCurrency(v: string): string {
    return v;
  }

  @Option({ flags: '--notes <text>', description: 'Notes' })
  parseNotes(v: string): string {
    return v;
  }

  @Option({ flags: '--terms <text>', description: 'Terms' })
  parseTerms(v: string): string {
    return v;
  }

  async run(_params: string[], options: AddOptions): Promise<void> {
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const fieldFlagsGiven = FIELD_OPTION_KEYS.some((key) => options[key] !== undefined);
    const wantsEditor = options.edit === true || (options.edit !== false && !fieldFlagsGiven);

    if (!wantsEditor && !fieldFlagsGiven) {
      throw new UsageError(
        'No fields given and --no-edit forbids the editor. Pass --issue-date, --due-date, --currency ' +
          'and --contact-id (or --company-id), or drop --no-edit.',
      );
    }

    const create = async (dto: Record<string, unknown>): Promise<void> => {
      const created = await client.post<InvoiceRecord>('/invoices', dto);
      process.stdout.write(`Created draft invoice "${created.number}" (${created.id}).\n`);
    };

    if (wantsEditor) {
      const initial = buildTemplate({
        schema: INVOICE_CREATE_SCHEMA,
        bodyField: 'notes',
        header: INVOICE_TEMPLATE_HEADER,
      });
      await this.editor.run({
        initial,
        filetype: 'md',
        submit: async (doc) => {
          const dto: Record<string, unknown> = { ...doc.fields };
          if (doc.body) dto.notes = doc.body;
          await create(dto);
        },
      });
      return;
    }

    // issueDate/dueDate/currency are required in CreateInvoiceDto's JSON
    // Schema (confirmed against src/generated/schemas.ts); the "contact or
    // company" rule is a `.refine()` that doesn't survive to JSON Schema
    // (same trap as CreateContactDto/CreateTransactionDto), so it is not
    // pre-checked here — flag mode goes straight to the server and surfaces
    // whatever 400 comes back, uncaught, same as contacts-add.command.ts.
    const missing = ['issueDate', 'dueDate', 'currency'].filter(
      (key) => options[key as keyof AddOptions] === undefined,
    );
    if (missing.length > 0) {
      throw new UsageError(missingFlagsMessage(missing));
    }

    const dto: Record<string, unknown> = {
      issueDate: options.issueDate,
      dueDate: options.dueDate,
      currency: options.currency,
    };
    if (options.contactId !== undefined) dto.contactId = options.contactId;
    if (options.companyId !== undefined) dto.companyId = options.companyId;
    if (options.projectId !== undefined) dto.projectId = options.projectId;
    if (options.notes !== undefined) dto.notes = options.notes;
    if (options.terms !== undefined) dto.terms = options.terms;

    await create(dto);
  }
}
