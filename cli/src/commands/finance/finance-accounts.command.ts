import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';
import { renderTable } from '../../core/render/table';
import { FinanceAccountsAddCommand } from './finance-accounts-add.command';
import type { FinancialAccountRecord } from './finance.helpers';

interface AccountsOptions {
  profile?: string;
  api?: string;
  json?: boolean;
}

/** Shared by the bare `finance accounts` action and its `ls` alias below. */
async function listAccounts(
  settings: SettingsService,
  clients: ClientFactory,
  options: AccountsOptions,
): Promise<void> {
  const resolved = settings.resolve(options);
  const client = clients.create(resolved);

  // Not paginated — `FinanceController.accounts` returns every account in
  // one call (see finance.helpers.ts's FinancialAccountRecord doc comment).
  const accounts = await client.get<FinancialAccountRecord[]>('/finance/accounts');

  if (options.json) {
    process.stdout.write(`${JSON.stringify(accounts, null, 2)}\n`);
    return;
  }

  if (accounts.length === 0) {
    process.stdout.write('No accounts.\n');
    return;
  }

  const table = renderTable(accounts, [
    { header: 'NAME', value: (a) => a.name },
    { header: 'KIND', value: (a) => a.kind },
    { header: 'CURRENCY', value: (a) => a.currency },
    // A decimal string, rendered verbatim — never parsed or reformatted.
    // See finance.helpers.ts's TransactionRecord doc comment.
    { header: 'BALANCE', value: (a) => a.currentBalance, align: 'right' },
    { header: 'ACTIVE', value: (a) => (a.isActive ? '*' : '') },
  ]);
  process.stdout.write(`${table}\n`);
}

/**
 * `finance accounts ls` — an explicit alias for the bare `finance accounts`
 * listing below, for muscle memory carried over from every other domain's
 * `<domain> ls` (contacts, tasks, ...). Declared before `FinanceAccountsCommand`
 * so it can be referenced in that class's `subCommands`.
 */
@SubCommand({ name: 'ls', description: 'List financial accounts' })
export class FinanceAccountsLsCommand extends CommandRunner {
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

  async run(_params: string[], options: AccountsOptions): Promise<void> {
    await listAccounts(this.settings, this.clients, options);
  }
}

/**
 * `finance accounts` lists directly rather than showing help when invoked
 * bare — commander runs a command's own action when no subcommand is given
 * and only routes to a subcommand (`add`, `ls`) when one is named, so all
 * three work off the same parent.
 */
@SubCommand({
  name: 'accounts',
  description: 'List financial accounts',
  subCommands: [FinanceAccountsAddCommand, FinanceAccountsLsCommand],
})
export class FinanceAccountsCommand extends CommandRunner {
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

  async run(_params: string[], options: AccountsOptions): Promise<void> {
    await listAccounts(this.settings, this.clients, options);
  }
}
