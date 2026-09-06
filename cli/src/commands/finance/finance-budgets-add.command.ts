import { Optional } from '@nestjs/common';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { EditorService } from '../../core/editor/editor.service';
import { buildTemplate } from '../../core/editor/template';
import { missingFlagsMessage } from '../../core/cli/flag-name';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import {
  FINANCE_BUDGET_CREATE_SCHEMA,
  FINANCE_BUDGET_TEMPLATE_HEADER,
  type BudgetRecord,
} from './finance.helpers';

interface AddOptions {
  profile?: string;
  api?: string;
  /** See ContactsAddCommand.parseEdit/parseNoEdit for why this is three-state. */
  edit?: boolean;
  name?: string;
  projectId?: string;
  categoryId?: string;
  periodStart?: string;
  periodEnd?: string;
  amount?: string;
  currency?: string;
  alertThresholdPct?: number;
}

const FIELD_OPTION_KEYS: (keyof AddOptions)[] = [
  'name',
  'projectId',
  'categoryId',
  'periodStart',
  'periodEnd',
  'amount',
  'currency',
  'alertThresholdPct',
];

@SubCommand({ name: 'add', description: 'Create a budget' })
export class FinanceBudgetsAddCommand extends CommandRunner {
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

  @Option({ flags: '--name <text>', description: 'Budget name' })
  parseName(v: string): string {
    return v;
  }

  @Option({ flags: '--project-id <uuid>', description: 'Project this budget scopes to' })
  parseProjectId(v: string): string {
    return v;
  }

  @Option({ flags: '--category-id <uuid>', description: 'Category this budget scopes to' })
  parseCategoryId(v: string): string {
    return v;
  }

  @Option({ flags: '--period-start <date>', description: 'YYYY-MM-DD' })
  parsePeriodStart(v: string): string {
    return v;
  }

  @Option({ flags: '--period-end <date>', description: 'YYYY-MM-DD' })
  parsePeriodEnd(v: string): string {
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

  @Option({ flags: '--alert-threshold-pct <n>', description: 'Percent of the budget that triggers at-risk (default 80)' })
  parseAlertThresholdPct(v: string): number {
    return Number(v);
  }

  async run(_params: string[], options: AddOptions): Promise<void> {
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const fieldFlagsGiven = FIELD_OPTION_KEYS.some((key) => options[key] !== undefined);
    const wantsEditor = options.edit === true || (options.edit !== false && !fieldFlagsGiven);

    if (!wantsEditor && !fieldFlagsGiven) {
      throw new UsageError(
        'No fields given and --no-edit forbids the editor. Pass --name, --period-start, --period-end, ' +
          '--amount and --currency (and others), or drop --no-edit.',
      );
    }

    const create = async (dto: Record<string, unknown>): Promise<void> => {
      const created = await client.post<BudgetRecord>('/finance/budgets', dto);
      process.stdout.write(`Created "${created.name}" (${created.id}).\n`);
    };

    if (wantsEditor) {
      const initial = buildTemplate({
        schema: FINANCE_BUDGET_CREATE_SCHEMA,
        header: FINANCE_BUDGET_TEMPLATE_HEADER,
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

    const missing = ['name', 'periodStart', 'periodEnd', 'amount', 'currency'].filter(
      (key) => options[key as keyof AddOptions] === undefined,
    );
    if (missing.length > 0) {
      throw new UsageError(missingFlagsMessage(missing));
    }

    const dto: Record<string, unknown> = {
      name: options.name,
      periodStart: options.periodStart,
      periodEnd: options.periodEnd,
      amount: options.amount,
      currency: options.currency,
    };
    if (options.projectId !== undefined) dto.projectId = options.projectId;
    if (options.categoryId !== undefined) dto.categoryId = options.categoryId;
    if (options.alertThresholdPct !== undefined) dto.alertThresholdPct = options.alertThresholdPct;

    await create(dto);
  }
}
