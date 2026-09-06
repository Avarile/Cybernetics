import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';
import { positiveInt } from '../../core/cli/positive-int';
import { renderTable } from '../../core/render/table';
import { morePagesNote, type ContactListEnvelope } from './contacts.helpers';

interface LsOptions {
  profile?: string;
  api?: string;
  json?: boolean;
  search?: string;
  status?: string;
  typeId?: string;
  categoryId?: string;
  companyId?: string;
  tagId?: string;
  page?: number;
  limit?: number;
}

@SubCommand({ name: 'ls', description: 'List contacts' })
export class ContactsLsCommand extends CommandRunner {
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

  @Option({ flags: '--search <text>', description: 'Search display name and email' })
  parseSearch(v: string): string {
    return v;
  }

  @Option({ flags: '--status <status>', description: 'Filter by status' })
  parseStatus(v: string): string {
    return v;
  }

  @Option({ flags: '--type-id <uuid>', description: 'Filter by contact type' })
  parseTypeId(v: string): string {
    return v;
  }

  @Option({ flags: '--category-id <uuid>', description: 'Filter by category' })
  parseCategoryId(v: string): string {
    return v;
  }

  @Option({ flags: '--company-id <uuid>', description: 'Filter by company' })
  parseCompanyId(v: string): string {
    return v;
  }

  @Option({ flags: '--tag-id <uuid>', description: 'Filter by tag' })
  parseTagId(v: string): string {
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
    if (options.search) query.set('search', options.search);
    if (options.status) query.set('status', options.status);
    if (options.typeId) query.set('typeId', options.typeId);
    if (options.categoryId) query.set('categoryId', options.categoryId);
    if (options.companyId) query.set('companyId', options.companyId);
    if (options.tagId) query.set('tagId', options.tagId);
    if (options.page) query.set('page', String(options.page));
    if (options.limit) query.set('limit', String(options.limit));

    const qs = query.toString();
    const envelope = await client.get<ContactListEnvelope>(`/contacts${qs ? `?${qs}` : ''}`);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
      return;
    }

    if (envelope.data.length === 0) {
      process.stdout.write('No contacts.\n');
      return;
    }

    const table = renderTable(envelope.data, [
      { header: 'NAME', value: (r) => r.displayName },
      { header: 'EMAIL', value: (r) => r.primaryEmail ?? '' },
      { header: 'PHONE', value: (r) => r.primaryPhone ?? '' },
      { header: 'STATUS', value: (r) => r.status },
      // Not COMPANY: PublicContact carries only companyId, never a resolved
      // name (see contact.service.ts's toPublic()), and a raw UUID in a
      // human-scannable table is worse than no column. jobTitle is always
      // meaningful when set and helps distinguish same-named contacts; it's
      // still visible as an id in `get`'s frontmatter and in `--json`, where
      // an id is genuinely actionable since `edit` sets the company by id.
      { header: 'TITLE', value: (r) => r.jobTitle ?? '' },
    ]);
    process.stdout.write(`${table}\n`);

    const note = morePagesNote(envelope);
    if (note) process.stdout.write(`\n${note}\n`);
  }
}
