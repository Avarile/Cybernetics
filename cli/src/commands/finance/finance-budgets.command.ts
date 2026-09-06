import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';
import { positiveInt } from '../../core/cli/positive-int';
import { renderTable } from '../../core/render/table';
import { FinanceBudgetsAddCommand } from './finance-budgets-add.command';
import { FinanceBudgetsAtRiskCommand } from './finance-budgets-at-risk.command';
import { budgetMorePagesNote, type BudgetListEnvelope } from './finance.helpers';

interface BudgetsOptions {
  profile?: string;
  api?: string;
  json?: boolean;
  projectId?: string;
  page?: number;
  limit?: number;
}

/** Shared by the bare `finance budgets` action and its `ls` alias below. */
async function listBudgets(
  settings: SettingsService,
  clients: ClientFactory,
  options: BudgetsOptions,
): Promise<void> {
  const resolved = settings.resolve(options);
  const client = clients.create(resolved);

  const query = new URLSearchParams();
  if (options.projectId) query.set('projectId', options.projectId);
  if (options.page) query.set('page', String(options.page));
  if (options.limit) query.set('limit', String(options.limit));

  const qs = query.toString();
  const envelope = await client.get<BudgetListEnvelope>(`/finance/budgets${qs ? `?${qs}` : ''}`);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    return;
  }

  if (envelope.rows.length === 0) {
    process.stdout.write('No budgets.\n');
    return;
  }

  const table = renderTable(envelope.rows, [
    { header: 'NAME', value: (b) => b.name },
    { header: 'PERIOD', value: (b) => `${b.periodStart}..${b.periodEnd}` },
    // Decimal strings, rendered verbatim — never parsed or reformatted.
    { header: 'AMOUNT', value: (b) => b.amount, align: 'right' },
    { header: 'SPENT', value: (b) => b.spentAmount, align: 'right' },
    { header: 'CURRENCY', value: (b) => b.currency },
    { header: 'STATUS', value: (b) => b.status },
  ]);
  process.stdout.write(`${table}\n`);

  const note = budgetMorePagesNote(envelope, options.page ?? 1, options.limit ?? 20);
  if (note) process.stdout.write(`\n${note}\n`);
}

/**
 * `finance budgets ls` — an explicit alias for the bare `finance budgets`
 * listing below, for muscle memory carried over from every other domain's
 * `<domain> ls` (contacts, tasks, ...). Declared before `FinanceBudgetsCommand`
 * so it can be referenced in that class's `subCommands`.
 */
@SubCommand({ name: 'ls', description: 'List budgets' })
export class FinanceBudgetsLsCommand extends CommandRunner {
  constructor(
    private readonly settings: SettingsService,
    private readonly clients: ClientFactory,
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

  @Option({ flags: '--json', description: 'Emit the raw { rows, total } envelope' })
  parseJson(): boolean {
    return true;
  }

  @Option({ flags: '--project-id <uuid>', description: 'Filter by project' })
  parseProjectId(v: string): string {
    return v;
  }

  @Option({ flags: '--page <n>', description: 'Page number (default 1)' })
  parsePage(v: string): number {
    return positiveInt('--page', v);
  }

  @Option({ flags: '--limit <n>', description: 'Rows per page (default 20)' })
  parseLimit(v: string): number {
    return positiveInt('--limit', v);
  }

  async run(_params: string[], options: BudgetsOptions): Promise<void> {
    await listBudgets(this.settings, this.clients, options);
  }
}

/**
 * `finance budgets` lists directly rather than showing help when invoked
 * bare — see FinanceAccountsCommand's doc comment for why the parent's own
 * action and its subcommands (`add`, `at-risk`, `ls`) coexist without
 * conflict.
 */
@SubCommand({
  name: 'budgets',
  description: 'List budgets',
  subCommands: [FinanceBudgetsAddCommand, FinanceBudgetsAtRiskCommand, FinanceBudgetsLsCommand],
})
export class FinanceBudgetsCommand extends CommandRunner {
  constructor(
    private readonly settings: SettingsService,
    private readonly clients: ClientFactory,
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

  @Option({ flags: '--json', description: 'Emit the raw { rows, total } envelope' })
  parseJson(): boolean {
    return true;
  }

  @Option({ flags: '--project-id <uuid>', description: 'Filter by project' })
  parseProjectId(v: string): string {
    return v;
  }

  @Option({ flags: '--page <n>', description: 'Page number (default 1)' })
  parsePage(v: string): number {
    return positiveInt('--page', v);
  }

  @Option({ flags: '--limit <n>', description: 'Rows per page (default 20)' })
  parseLimit(v: string): number {
    return positiveInt('--limit', v);
  }

  async run(_params: string[], options: BudgetsOptions): Promise<void> {
    await listBudgets(this.settings, this.clients, options);
  }
}
