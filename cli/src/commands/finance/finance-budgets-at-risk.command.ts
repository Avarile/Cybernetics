import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';
import { renderTable } from '../../core/render/table';
import type { BudgetAtRisk } from './finance.helpers';

interface AtRiskOptions {
  profile?: string;
  api?: string;
  json?: boolean;
}

@SubCommand({ name: 'at-risk', description: 'Budgets at or past their alert threshold' })
export class FinanceBudgetsAtRiskCommand extends CommandRunner {
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

  @Option({ flags: '--json', description: 'Emit the raw array' })
  parseJson(): boolean {
    return true;
  }

  async run(_params: string[], options: AtRiskOptions): Promise<void> {
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    // A bare, unpaginated array — see finance.helpers.ts's BudgetAtRisk doc comment.
    const rows = await client.get<BudgetAtRisk[]>('/finance/budgets/at-risk');

    if (options.json) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
      return;
    }

    if (rows.length === 0) {
      process.stdout.write('No budgets at risk.\n');
      return;
    }

    const table = renderTable(rows, [
      { header: 'NAME', value: (r) => r.budget.name },
      // Decimal strings, rendered verbatim — never parsed or reformatted.
      { header: 'SPENT', value: (r) => r.budget.spentAmount, align: 'right' },
      { header: 'AMOUNT', value: (r) => r.budget.amount, align: 'right' },
      { header: 'CURRENCY', value: (r) => r.budget.currency },
      // Server-computed (`LedgerService.budgetsAtRisk`), not derived here.
      { header: 'USED%', value: (r) => String(r.usedPct), align: 'right' },
    ]);
    process.stdout.write(`${table}\n`);
  }
}
