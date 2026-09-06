import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';
import { positiveInt } from '../../core/cli/positive-int';
import { renderTable } from '../../core/render/table';
import { morePagesNote, resolveAccountNames, type TransactionListEnvelope } from './finance.helpers';

interface LsOptions {
  profile?: string;
  api?: string;
  json?: boolean;
  kind?: string;
  status?: string;
  accountId?: string;
  categoryId?: string;
  projectId?: string;
  contactId?: string;
  companyId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

@SubCommand({ name: 'ls', description: 'List transactions' })
export class FinanceTxLsCommand extends CommandRunner {
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

  @Option({ flags: '--kind <kind>', description: 'income|expense|transfer' })
  parseKind(v: string): string {
    return v;
  }

  @Option({ flags: '--status <status>', description: 'draft|pending|cleared|reconciled|void' })
  parseStatus(v: string): string {
    return v;
  }

  @Option({ flags: '--account-id <uuid>', description: 'Filter by account' })
  parseAccountId(v: string): string {
    return v;
  }

  @Option({ flags: '--category-id <uuid>', description: 'Filter by category' })
  parseCategoryId(v: string): string {
    return v;
  }

  @Option({ flags: '--project-id <uuid>', description: 'Filter by project' })
  parseProjectId(v: string): string {
    return v;
  }

  @Option({ flags: '--contact-id <uuid>', description: 'Filter by contact' })
  parseContactId(v: string): string {
    return v;
  }

  @Option({ flags: '--company-id <uuid>', description: 'Filter by company' })
  parseCompanyId(v: string): string {
    return v;
  }

  @Option({ flags: '--from <date>', description: 'YYYY-MM-DD' })
  parseFrom(v: string): string {
    return v;
  }

  @Option({ flags: '--to <date>', description: 'YYYY-MM-DD' })
  parseTo(v: string): string {
    return v;
  }

  @Option({ flags: '--page <n>', description: 'Page number (default 1)' })
  parsePage(v: string): number {
    return positiveInt('--page', v);
  }

  // 50, not the 20 most other `ls` commands default to: `listTransactionsSchema`
  // (api/src/features/finance/dto/finance.dto.ts) genuinely defaults to 50 when
  // `--limit` is omitted, so documenting 20 here would just be wrong.
  @Option({ flags: '--limit <n>', description: 'Rows per page (default 50)' })
  parseLimit(v: string): number {
    return positiveInt('--limit', v);
  }

  async run(_params: string[], options: LsOptions): Promise<void> {
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const query = new URLSearchParams();
    if (options.kind) query.set('kind', options.kind);
    if (options.status) query.set('status', options.status);
    if (options.accountId) query.set('accountId', options.accountId);
    if (options.categoryId) query.set('categoryId', options.categoryId);
    if (options.projectId) query.set('projectId', options.projectId);
    if (options.contactId) query.set('contactId', options.contactId);
    if (options.companyId) query.set('companyId', options.companyId);
    if (options.from) query.set('from', options.from);
    if (options.to) query.set('to', options.to);
    if (options.page) query.set('page', String(options.page));
    if (options.limit) query.set('limit', String(options.limit));

    const qs = query.toString();
    const envelope = await client.get<TransactionListEnvelope>(`/finance/transactions${qs ? `?${qs}` : ''}`);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
      return;
    }

    if (envelope.data.length === 0) {
      process.stdout.write('No transactions.\n');
      return;
    }

    // ACCOUNT: TransactionRow carries only accountId (see finance.helpers.ts's
    // TransactionRecord doc comment) — a bare UUID is forbidden here (see the
    // ASSIGNEE/REF reasoning in tasks-ls.command.ts), so it's resolved via
    // resolveAccountNames, one unpaginated call regardless of page size.
    const namesById = await resolveAccountNames(client);

    const table = renderTable(envelope.data, [
      { header: 'DATE', value: (t) => t.occurredOn },
      { header: 'DESCRIPTION', value: (t) => t.description, maxWidth: 50 },
      // A decimal string, rendered verbatim — never parsed, summed or
      // reformatted. See finance.helpers.ts's TransactionRecord doc comment.
      { header: 'AMOUNT', value: (t) => t.amount, align: 'right' },
      { header: 'CURRENCY', value: (t) => t.currency },
      { header: 'STATUS', value: (t) => t.status },
      { header: 'ACCOUNT', value: (t) => namesById.get(t.accountId) ?? t.accountId },
    ]);
    process.stdout.write(`${table}\n`);

    const note = morePagesNote(envelope);
    if (note) process.stdout.write(`\n${note}\n`);
  }
}
