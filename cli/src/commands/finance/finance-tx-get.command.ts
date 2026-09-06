import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { stringify } from 'yaml';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';
import type { TransactionRecord } from './finance.helpers';

interface GetOptions {
  profile?: string;
  api?: string;
  json?: boolean;
}

@SubCommand({ name: 'get', arguments: '<id>', description: 'Show a transaction' })
export class FinanceTxGetCommand extends CommandRunner {
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

  @Option({ flags: '--json', description: 'Emit the raw record' })
  parseJson(): boolean {
    return true;
  }

  async run(params: string[], options: GetOptions): Promise<void> {
    const [id] = params;
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const record = await client.get<TransactionRecord>(`/finance/transactions/${id}`);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
      return;
    }

    // There is no `tx edit` — transactions are immutable once settled (see
    // ledger.service.ts) — so unlike contacts/tasks/projects, `get` has no
    // editable-template counterpart to reuse. A plain YAML dump of the raw
    // record is the whole of the human view; amounts print exactly as the
    // API sent them (decimal strings), never reformatted.
    process.stdout.write(stringify(record));
  }
}
