import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';
import { AddressResolver, invoiceByNumber } from '../../core/resolve/resolver';
import type { InvoiceRecord } from './invoices.helpers';

interface IssueOptions {
  profile?: string;
  api?: string;
}

/**
 * Allocates the invoice's number and freezes it — the plan does not list
 * this among the commands requiring `--yes` (unlike `finance tx reverse`),
 * and there is no body to build: `POST /invoices/{id}/issue` takes none.
 */
@SubCommand({
  name: 'issue',
  arguments: '<addr>',
  description: 'Issue a draft invoice, allocating its number (accepts a number, e.g. INV-2026-0001)',
})
export class InvoicesIssueCommand extends CommandRunner {
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

  async run(params: string[], options: IssueOptions): Promise<void> {
    const [addr] = params;
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const id = await new AddressResolver(client).resolve(addr, invoiceByNumber);
    const issued = await client.post<InvoiceRecord>(`/invoices/${id}/issue`);
    process.stdout.write(`Issued "${issued.number}" (${issued.status}).\n`);
  }
}
