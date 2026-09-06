import { Optional } from '@nestjs/common';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { EditorService } from '../../core/editor/editor.service';
import { buildTemplate } from '../../core/editor/template';
import { missingFlagsMessage } from '../../core/cli/flag-name';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import { FINANCE_TX_CREATE_SCHEMA, FINANCE_TX_TEMPLATE_HEADER, type TransactionRecord } from './finance.helpers';

interface AddOptions {
  profile?: string;
  api?: string;
  /** See ContactsAddCommand.parseEdit/parseNoEdit for why this is three-state. */
  edit?: boolean;
  kind?: string;
  occurredOn?: string;
  amount?: string;
  currency?: string;
  accountId?: string;
  counterAccountId?: string;
  categoryId?: string;
  projectId?: string;
  taskId?: string;
  contactId?: string;
  companyId?: string;
  description?: string;
  reference?: string;
  receiptFileId?: string;
  status?: string;
  baseAmount?: string;
  fxRate?: string;
}

const FIELD_OPTION_KEYS: (keyof AddOptions)[] = [
  'kind',
  'occurredOn',
  'amount',
  'currency',
  'accountId',
  'counterAccountId',
  'categoryId',
  'projectId',
  'taskId',
  'contactId',
  'companyId',
  'description',
  'reference',
  'receiptFileId',
  'status',
  'baseAmount',
  'fxRate',
];

@SubCommand({ name: 'add', description: 'Record income, spending or a transfer' })
export class FinanceTxAddCommand extends CommandRunner {
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

  @Option({ flags: '--kind <kind>', description: 'income|expense|transfer' })
  parseKind(v: string): string {
    return v;
  }

  @Option({ flags: '--occurred-on <date>', description: 'YYYY-MM-DD' })
  parseOccurredOn(v: string): string {
    return v;
  }

  @Option({ flags: '--amount <decimal>', description: 'Always positive; kind carries the sign' })
  parseAmount(v: string): string {
    return v;
  }

  @Option({ flags: '--currency <code>', description: 'Three-letter currency code' })
  parseCurrency(v: string): string {
    return v;
  }

  @Option({ flags: '--account-id <uuid>', description: 'Account this transaction posts to' })
  parseAccountId(v: string): string {
    return v;
  }

  @Option({ flags: '--counter-account-id <uuid>', description: 'Required for kind=transfer' })
  parseCounterAccountId(v: string): string {
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

  @Option({ flags: '--task-id <uuid>', description: 'Task id' })
  parseTaskId(v: string): string {
    return v;
  }

  @Option({ flags: '--contact-id <uuid>', description: 'Payer (income) or payee (expense)' })
  parseContactId(v: string): string {
    return v;
  }

  @Option({ flags: '--company-id <uuid>', description: 'Payer (income) or payee (expense)' })
  parseCompanyId(v: string): string {
    return v;
  }

  @Option({ flags: '--description <text>', description: 'Description' })
  parseDescription(v: string): string {
    return v;
  }

  @Option({ flags: '--reference <text>', description: 'Free-text reference' })
  parseReference(v: string): string {
    return v;
  }

  @Option({ flags: '--receipt-file-id <uuid>', description: 'Attached receipt file id' })
  parseReceiptFileId(v: string): string {
    return v;
  }

  @Option({ flags: '--status <status>', description: 'draft|pending|cleared|reconciled|void (default draft)' })
  parseStatus(v: string): string {
    return v;
  }

  @Option({ flags: '--base-amount <decimal>', description: 'Amount converted to the base currency' })
  parseBaseAmount(v: string): string {
    return v;
  }

  @Option({ flags: '--fx-rate <decimal>', description: 'Rate applied for a cross-currency posting' })
  parseFxRate(v: string): string {
    return v;
  }

  async run(_params: string[], options: AddOptions): Promise<void> {
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const fieldFlagsGiven = FIELD_OPTION_KEYS.some((key) => options[key] !== undefined);
    const wantsEditor = options.edit === true || (options.edit !== false && !fieldFlagsGiven);

    if (!wantsEditor && !fieldFlagsGiven) {
      throw new UsageError(
        'No fields given and --no-edit forbids the editor. Pass --kind, --occurred-on, --amount, ' +
          '--currency, --account-id and --description (and others), or drop --no-edit.',
      );
    }

    const create = async (dto: Record<string, unknown>): Promise<void> => {
      const created = await client.post<TransactionRecord>('/finance/transactions', dto);
      process.stdout.write(`Recorded "${created.description}" (${created.amount}, ${created.id}).\n`);
    };

    if (wantsEditor) {
      const initial = buildTemplate({
        schema: FINANCE_TX_CREATE_SCHEMA,
        header: FINANCE_TX_TEMPLATE_HEADER,
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

    // kind/occurredOn/amount/currency/accountId/description are all required
    // in CreateTransactionDto's JSON Schema (confirmed against
    // src/generated/schemas.ts), so flag mode checks for them up front.
    const missing = ['kind', 'occurredOn', 'amount', 'currency', 'accountId', 'description'].filter(
      (key) => options[key as keyof AddOptions] === undefined,
    );
    if (missing.length > 0) {
      throw new UsageError(missingFlagsMessage(missing));
    }

    const dto: Record<string, unknown> = {
      kind: options.kind,
      occurredOn: options.occurredOn,
      amount: options.amount,
      currency: options.currency,
      accountId: options.accountId,
      description: options.description,
    };
    if (options.counterAccountId !== undefined) dto.counterAccountId = options.counterAccountId;
    if (options.categoryId !== undefined) dto.categoryId = options.categoryId;
    if (options.projectId !== undefined) dto.projectId = options.projectId;
    if (options.taskId !== undefined) dto.taskId = options.taskId;
    if (options.contactId !== undefined) dto.contactId = options.contactId;
    if (options.companyId !== undefined) dto.companyId = options.companyId;
    if (options.reference !== undefined) dto.reference = options.reference;
    if (options.receiptFileId !== undefined) dto.receiptFileId = options.receiptFileId;
    if (options.status !== undefined) dto.status = options.status;
    if (options.baseAmount !== undefined) dto.baseAmount = options.baseAmount;
    if (options.fxRate !== undefined) dto.fxRate = options.fxRate;

    await create(dto);
  }
}
