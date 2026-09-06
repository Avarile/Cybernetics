import { Optional } from '@nestjs/common';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { EditorService } from '../../core/editor/editor.service';
import { buildTemplate } from '../../core/editor/template';
import { missingFlagsMessage } from '../../core/cli/flag-name';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import { AddressResolver, invoiceByNumber } from '../../core/resolve/resolver';
import {
  INVOICE_BILL_TIME_SCHEMA,
  INVOICE_BILL_TIME_TEMPLATE_HEADER,
  type InvoiceLineItemRecord,
} from './invoices.helpers';

interface BillTimeOptions {
  profile?: string;
  api?: string;
  /** See ContactsAddCommand.parseEdit/parseNoEdit for why this is three-state. */
  edit?: boolean;
  projectId?: string;
  timeEntries?: string;
  description?: string;
  unitPrice?: string;
  taxRatePct?: string;
}

const FIELD_OPTION_KEYS: (keyof BillTimeOptions)[] = [
  'projectId',
  'timeEntries',
  'description',
  'unitPrice',
  'taxRatePct',
];

@SubCommand({
  name: 'bill-time',
  arguments: '<addr>',
  description: 'Bill logged time onto a draft invoice (accepts a number, e.g. INV-2026-0001)',
})
export class InvoicesBillTimeCommand extends CommandRunner {
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

  @Option({ flags: '--project-id <uuid>', description: 'Project the time entries belong to' })
  parseProjectId(v: string): string {
    return v;
  }

  @Option({ flags: '--time-entries <ids>', description: 'Comma-separated time-entry UUIDs to bill' })
  parseTimeEntries(v: string): string {
    return v;
  }

  @Option({ flags: '--description <text>', description: 'Line description' })
  parseDescription(v: string): string {
    return v;
  }

  @Option({ flags: '--unit-price <decimal>', description: 'Decimal rate per hour' })
  parseUnitPrice(v: string): string {
    return v;
  }

  @Option({ flags: '--tax-rate-pct <decimal>', description: 'Decimal percent, 0-100 (default 0)' })
  parseTaxRatePct(v: string): string {
    return v;
  }

  async run(params: string[], options: BillTimeOptions): Promise<void> {
    const [addr] = params;
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);
    const id = await new AddressResolver(client).resolve(addr, invoiceByNumber);

    const fieldFlagsGiven = FIELD_OPTION_KEYS.some((key) => options[key] !== undefined);
    const wantsEditor = options.edit === true || (options.edit !== false && !fieldFlagsGiven);

    if (!wantsEditor && !fieldFlagsGiven) {
      throw new UsageError(
        'No fields given and --no-edit forbids the editor. Pass --project-id, --time-entries, ' +
          '--description and --unit-price, or drop --no-edit.',
      );
    }

    const bill = async (dto: Record<string, unknown>): Promise<void> => {
      const created = await client.post<InvoiceLineItemRecord>(`/invoices/${id}/bill-time`, dto);
      process.stdout.write(`Billed "${created.description}" (${created.total}).\n`);
    };

    if (wantsEditor) {
      const initial = buildTemplate({
        schema: INVOICE_BILL_TIME_SCHEMA,
        header: INVOICE_BILL_TIME_TEMPLATE_HEADER,
      });
      await this.editor.run({
        initial,
        filetype: 'md',
        submit: async (doc) => {
          await bill({ ...doc.fields });
        },
      });
      return;
    }

    const missing = ['projectId', 'timeEntries', 'description', 'unitPrice'].filter(
      (key) => options[key as keyof BillTimeOptions] === undefined,
    );
    if (missing.length > 0) {
      throw new UsageError(missingFlagsMessage(missing));
    }

    const dto: Record<string, unknown> = {
      projectId: options.projectId,
      timeEntryIds: options.timeEntries!
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      description: options.description,
      unitPrice: options.unitPrice,
    };
    if (options.taxRatePct !== undefined) dto.taxRatePct = options.taxRatePct;

    await bill(dto);
  }
}
