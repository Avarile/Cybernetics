import { Optional } from '@nestjs/common';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { EditorService } from '../../core/editor/editor.service';
import { buildTemplate } from '../../core/editor/template';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import {
  FINANCE_ACCOUNT_CREATE_SCHEMA,
  FINANCE_ACCOUNT_TEMPLATE_HEADER,
  type FinancialAccountRecord,
} from './finance.helpers';

interface AddOptions {
  profile?: string;
  api?: string;
  /** See ContactsAddCommand.parseEdit/parseNoEdit for why this is three-state. */
  edit?: boolean;
  name?: string;
  kind?: string;
  currency?: string;
  openingBalance?: string;
  institution?: string;
  accountRef?: string;
}

const FIELD_OPTION_KEYS: (keyof AddOptions)[] = [
  'name',
  'kind',
  'currency',
  'openingBalance',
  'institution',
  'accountRef',
];

@SubCommand({ name: 'add', description: 'Create a financial account' })
export class FinanceAccountsAddCommand extends CommandRunner {
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

  @Option({ flags: '--name <text>', description: 'Account name' })
  parseName(v: string): string {
    return v;
  }

  @Option({ flags: '--kind <kind>', description: 'bank|cash|credit_card|receivable|payable|other (default bank)' })
  parseKind(v: string): string {
    return v;
  }

  @Option({ flags: '--currency <code>', description: 'Three-letter currency code' })
  parseCurrency(v: string): string {
    return v;
  }

  @Option({ flags: '--opening-balance <amount>', description: 'Decimal amount (default 0)' })
  parseOpeningBalance(v: string): string {
    return v;
  }

  @Option({ flags: '--institution <text>', description: 'Institution name' })
  parseInstitution(v: string): string {
    return v;
  }

  @Option({ flags: '--account-ref <text>', description: 'Masked reference only — never a full account number' })
  parseAccountRef(v: string): string {
    return v;
  }

  async run(_params: string[], options: AddOptions): Promise<void> {
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const fieldFlagsGiven = FIELD_OPTION_KEYS.some((key) => options[key] !== undefined);
    const wantsEditor = options.edit === true || (options.edit !== false && !fieldFlagsGiven);

    if (!wantsEditor && !fieldFlagsGiven) {
      throw new UsageError(
        'No fields given and --no-edit forbids the editor. Pass --name and --currency (and others), or drop --no-edit.',
      );
    }

    const create = async (dto: Record<string, unknown>): Promise<void> => {
      const created = await client.post<FinancialAccountRecord>('/finance/accounts', dto);
      process.stdout.write(`Created "${created.name}" (${created.id}).\n`);
    };

    if (wantsEditor) {
      const initial = buildTemplate({
        schema: FINANCE_ACCOUNT_CREATE_SCHEMA,
        header: FINANCE_ACCOUNT_TEMPLATE_HEADER,
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

    if (options.name === undefined) throw new UsageError('--name is required.');
    if (options.currency === undefined) throw new UsageError('--currency is required.');

    const dto: Record<string, unknown> = { name: options.name, currency: options.currency };
    if (options.kind !== undefined) dto.kind = options.kind;
    if (options.openingBalance !== undefined) dto.openingBalance = options.openingBalance;
    if (options.institution !== undefined) dto.institution = options.institution;
    if (options.accountRef !== undefined) dto.accountRef = options.accountRef;

    await create(dto);
  }
}
