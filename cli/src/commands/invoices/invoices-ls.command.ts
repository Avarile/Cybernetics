import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';
import { positiveInt } from '../../core/cli/positive-int';
import { renderTable } from '../../core/render/table';
import { billToName, morePagesNote, type InvoiceListEnvelope } from './invoices.helpers';

interface LsOptions {
  profile?: string;
  api?: string;
  json?: boolean;
  status?: string;
  contactId?: string;
  companyId?: string;
  projectId?: string;
  page?: number;
  limit?: number;
}

@SubCommand({ name: 'ls', description: 'List invoices' })
export class InvoicesLsCommand extends CommandRunner {
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

  @Option({ flags: '--json', description: 'Emit the raw list envelope' })
  parseJson(): boolean {
    return true;
  }

  @Option({ flags: '--status <status>', description: 'draft|sent|partially_paid|paid|overdue|void' })
  parseStatus(v: string): string {
    return v;
  }

  @Option({ flags: '--contact-id <uuid>', description: 'Filter by bill-to contact' })
  parseContactId(v: string): string {
    return v;
  }

  @Option({ flags: '--company-id <uuid>', description: 'Filter by bill-to company' })
  parseCompanyId(v: string): string {
    return v;
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

  async run(_params: string[], options: LsOptions): Promise<void> {
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const query = new URLSearchParams();
    if (options.status) query.set('status', options.status);
    if (options.contactId) query.set('contactId', options.contactId);
    if (options.companyId) query.set('companyId', options.companyId);
    if (options.projectId) query.set('projectId', options.projectId);
    if (options.page) query.set('page', String(options.page));
    if (options.limit) query.set('limit', String(options.limit));

    const qs = query.toString();
    const envelope = await client.get<InvoiceListEnvelope>(`/invoices${qs ? `?${qs}` : ''}`);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
      return;
    }

    if (envelope.data.length === 0) {
      process.stdout.write('No invoices.\n');
      return;
    }

    const table = renderTable(envelope.data, [
      { header: 'NUMBER', value: (i) => i.number },
      { header: 'STATUS', value: (i) => i.status },
      { header: 'DUE', value: (i) => i.dueDate },
      // A decimal string, rendered verbatim — never parsed or reformatted.
      { header: 'TOTAL', value: (i) => i.total, align: 'right' },
      { header: 'CURRENCY', value: (i) => i.currency },
      // CONTACT: InvoiceRow carries only contactId/companyId (bare ids —
      // forbidden, see the ACCOUNT/ASSIGNEE reasoning elsewhere); the
      // bill-to name frozen at creation is real payload data already on the
      // row, so no lookup is needed. See invoices.helpers.ts's billToName.
      { header: 'CONTACT', value: (i) => billToName(i.billToSnapshot) },
    ]);
    process.stdout.write(`${table}\n`);

    const note = morePagesNote(envelope);
    if (note) process.stdout.write(`\n${note}\n`);
  }
}
