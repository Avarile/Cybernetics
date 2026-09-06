import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';
import { positiveInt } from '../../core/cli/positive-int';
import { formatLocalDateTime } from '../../core/render/format-date';
import { renderTable } from '../../core/render/table';
import { morePagesNote, withheldRowsNote, type KnowledgeListEnvelope } from './knowledge.helpers';

interface LsOptions {
  profile?: string;
  api?: string;
  json?: boolean;
  status?: string;
  search?: string;
  typeId?: string;
  categoryId?: string;
  tagId?: string;
  page?: number;
  limit?: number;
}

@SubCommand({ name: 'ls', description: 'List knowledge records' })
export class KnowledgeLsCommand extends CommandRunner {
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

  @Option({ flags: '--status <status>', description: 'Filter by status' })
  parseStatus(v: string): string {
    return v;
  }

  @Option({ flags: '--search <text>', description: 'Search title and summary' })
  parseSearch(v: string): string {
    return v;
  }

  @Option({ flags: '--type-id <uuid>', description: 'Filter by knowledge type' })
  parseTypeId(v: string): string {
    return v;
  }

  @Option({ flags: '--category-id <uuid>', description: 'Filter by category' })
  parseCategoryId(v: string): string {
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
    if (options.tagId) query.set('tagId', options.tagId);
    if (options.page) query.set('page', String(options.page));
    if (options.limit) query.set('limit', String(options.limit));

    const qs = query.toString();
    const envelope = await client.get<KnowledgeListEnvelope>(`/knowledge${qs ? `?${qs}` : ''}`);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
      return;
    }

    if (envelope.data.length === 0) {
      process.stdout.write('No knowledge records.\n');
      return;
    }

    const table = renderTable(envelope.data, [
      { header: 'STATUS', value: (r) => r.status },
      { header: 'TITLE', value: (r) => r.title, maxWidth: 40 },
      { header: 'SLUG', value: (r) => r.slug },
      { header: 'UPDATED', value: (r) => formatLocalDateTime(r.updatedAt) },
    ]);
    process.stdout.write(`${table}\n`);

    // Two distinct facts, both worth surfacing. Unlike every other domain,
    // knowledge's own `total` is *not* the count across all pages — the
    // service reports `visible.length` there (see KnowledgeService.list in
    // api/src/features/knowledge/knowledge.service.ts), i.e. it's always
    // exactly `data.length`. The real across-all-pages count is
    // `totalBeforeAccess`, so that's what "more pages" has to be computed
    // against — feeding it `envelope.total` as-is would make morePagesNote
    // silently never fire. `withheldRowsNote` reports the other fact: rows
    // withheld by the access filter on *this* page.
    const truePageTotal = envelope.totalBeforeAccess ?? envelope.total;
    for (const note of [morePagesNote({ ...envelope, total: truePageTotal }), withheldRowsNote(envelope)]) {
      if (note) process.stdout.write(`\n${note}\n`);
    }
  }
}
