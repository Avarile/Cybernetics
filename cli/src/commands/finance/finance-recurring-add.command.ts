import { Optional } from '@nestjs/common';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { EditorService } from '../../core/editor/editor.service';
import { buildTemplate } from '../../core/editor/template';
import { missingFlagsMessage } from '../../core/cli/flag-name';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import {
  FINANCE_RECURRING_CREATE_SCHEMA,
  FINANCE_RECURRING_TEMPLATE_HEADER,
  type RecurringTransactionRecord,
} from './finance.helpers';

interface AddOptions {
  profile?: string;
  api?: string;
  /** See ContactsAddCommand.parseEdit/parseNoEdit for why this is three-state. */
  edit?: boolean;
  name?: string;
  kind?: string;
  amount?: string;
  currency?: string;
  frequency?: string;
  dayOfPeriod?: number;
  startDate?: string;
  endDate?: string;
  accountId?: string;
  categoryId?: string;
  projectId?: string;
  contactId?: string;
  companyId?: string;
  autoPost?: boolean;
  description?: string;
}

const FIELD_OPTION_KEYS: (keyof AddOptions)[] = [
  'name',
  'kind',
  'amount',
  'currency',
  'frequency',
  'dayOfPeriod',
  'startDate',
  'endDate',
  'accountId',
  'categoryId',
  'projectId',
  'contactId',
  'companyId',
  'autoPost',
  'description',
];

@SubCommand({ name: 'add', description: 'Schedule recurring income or expense' })
export class FinanceRecurringAddCommand extends CommandRunner {
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

  @Option({ flags: '--name <text>', description: 'Schedule name' })
  parseName(v: string): string {
    return v;
  }

  @Option({ flags: '--kind <kind>', description: 'income|expense|transfer' })
  parseKind(v: string): string {
    return v;
  }

  @Option({ flags: '--amount <decimal>', description: 'Decimal amount' })
  parseAmount(v: string): string {
    return v;
  }

  @Option({ flags: '--currency <code>', description: 'Three-letter currency code' })
  parseCurrency(v: string): string {
    return v;
  }

  @Option({ flags: '--frequency <freq>', description: 'weekly|fortnightly|monthly|quarterly|yearly' })
  parseFrequency(v: string): string {
    return v;
  }

  @Option({ flags: '--day-of-period <n>', description: 'Anchor day, interpreted per --frequency' })
  parseDayOfPeriod(v: string): number {
    return Number(v);
  }

  @Option({ flags: '--start-date <date>', description: 'YYYY-MM-DD' })
  parseStartDate(v: string): string {
    return v;
  }

  @Option({ flags: '--end-date <date>', description: 'YYYY-MM-DD' })
  parseEndDate(v: string): string {
    return v;
  }

  @Option({ flags: '--account-id <uuid>', description: 'Account to post to when materialized' })
  parseAccountId(v: string): string {
    return v;
  }

  @Option({ flags: '--category-id <uuid>', description: 'Financial category' })
  parseCategoryId(v: string): string {
    return v;
  }

  @Option({ flags: '--project-id <uuid>', description: 'Project id' })
  parseProjectId(v: string): string {
    return v;
  }

  @Option({ flags: '--contact-id <uuid>', description: 'Payer or payee' })
  parseContactId(v: string): string {
    return v;
  }

  @Option({ flags: '--company-id <uuid>', description: 'Payer or payee' })
  parseCompanyId(v: string): string {
    return v;
  }

  @Option({ flags: '--auto-post', description: 'Post generated occurrences automatically (default: forecast only)' })
  parseAutoPost(): boolean {
    return true;
  }

  @Option({ flags: '--description <text>', description: 'Description' })
  parseDescription(v: string): string {
    return v;
  }

  async run(_params: string[], options: AddOptions): Promise<void> {
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const fieldFlagsGiven = FIELD_OPTION_KEYS.some((key) => options[key] !== undefined);
    const wantsEditor = options.edit === true || (options.edit !== false && !fieldFlagsGiven);

    if (!wantsEditor && !fieldFlagsGiven) {
      throw new UsageError(
        'No fields given and --no-edit forbids the editor. Pass --name, --kind, --amount, --currency, ' +
          '--frequency and --start-date (and others), or drop --no-edit.',
      );
    }

    const create = async (dto: Record<string, unknown>): Promise<void> => {
      const created = await client.post<RecurringTransactionRecord>('/finance/recurring', dto);
      process.stdout.write(`Scheduled "${created.name}" (${created.id}).\n`);
    };

    if (wantsEditor) {
      const initial = buildTemplate({
        schema: FINANCE_RECURRING_CREATE_SCHEMA,
        header: FINANCE_RECURRING_TEMPLATE_HEADER,
      });
      await this.editor.run({
        initial,
        filetype: 'md',
        submit: async (doc) => {
          await create({ ...doc.fields });
        },
      });
      return;
    }

    const missing = ['name', 'kind', 'amount', 'currency', 'frequency', 'startDate'].filter(
      (key) => options[key as keyof AddOptions] === undefined,
    );
    if (missing.length > 0) {
      throw new UsageError(missingFlagsMessage(missing));
    }

    const dto: Record<string, unknown> = {
      name: options.name,
      kind: options.kind,
      amount: options.amount,
      currency: options.currency,
      frequency: options.frequency,
      startDate: options.startDate,
    };
    if (options.dayOfPeriod !== undefined) dto.dayOfPeriod = options.dayOfPeriod;
    if (options.endDate !== undefined) dto.endDate = options.endDate;
    if (options.accountId !== undefined) dto.accountId = options.accountId;
    if (options.categoryId !== undefined) dto.categoryId = options.categoryId;
    if (options.projectId !== undefined) dto.projectId = options.projectId;
    if (options.contactId !== undefined) dto.contactId = options.contactId;
    if (options.companyId !== undefined) dto.companyId = options.companyId;
    if (options.autoPost !== undefined) dto.autoPost = options.autoPost;
    if (options.description !== undefined) dto.description = options.description;

    await create(dto);
  }
}
