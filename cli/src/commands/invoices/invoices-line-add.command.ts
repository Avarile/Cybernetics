import { Optional } from '@nestjs/common';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { EditorService } from '../../core/editor/editor.service';
import { buildTemplate } from '../../core/editor/template';
import { missingFlagsMessage } from '../../core/cli/flag-name';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import { AddressResolver, invoiceByNumber } from '../../core/resolve/resolver';
import { INVOICE_LINE_CREATE_SCHEMA, INVOICE_LINE_TEMPLATE_HEADER, type InvoiceLineItemRecord } from './invoices.helpers';

interface AddOptions {
  profile?: string;
  api?: string;
  /** See ContactsAddCommand.parseEdit/parseNoEdit for why this is three-state. */
  edit?: boolean;
  description?: string;
  quantity?: string;
  unit?: string;
  unitPrice?: string;
  taxRatePct?: string;
  taskId?: string;
  projectId?: string;
}

const FIELD_OPTION_KEYS: (keyof AddOptions)[] = [
  'description',
  'quantity',
  'unit',
  'unitPrice',
  'taxRatePct',
  'taskId',
  'projectId',
];

@SubCommand({
  name: 'add',
  arguments: '<addr>',
  description: 'Add a line item to a draft invoice (accepts a number, e.g. INV-2026-0001)',
})
export class InvoicesLineAddCommand extends CommandRunner {
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

  @Option({ flags: '--description <text>', description: 'Line description' })
  parseDescription(v: string): string {
    return v;
  }

  @Option({ flags: '--quantity <decimal>', description: 'Decimal quantity' })
  parseQuantity(v: string): string {
    return v;
  }

  @Option({ flags: '--unit <text>', description: 'Unit label (e.g. hour)' })
  parseUnit(v: string): string {
    return v;
  }

  @Option({ flags: '--unit-price <decimal>', description: 'Decimal unit price' })
  parseUnitPrice(v: string): string {
    return v;
  }

  @Option({ flags: '--tax-rate-pct <decimal>', description: 'Decimal percent, 0-100 (default 0)' })
  parseTaxRatePct(v: string): string {
    return v;
  }

  @Option({ flags: '--task-id <uuid>', description: 'Task id' })
  parseTaskId(v: string): string {
    return v;
  }

  @Option({ flags: '--project-id <uuid>', description: 'Project id (defaults to the invoice\'s own)' })
  parseProjectId(v: string): string {
    return v;
  }

  async run(params: string[], options: AddOptions): Promise<void> {
    const [addr] = params;
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);
    const id = await new AddressResolver(client).resolve(addr, invoiceByNumber);

    const fieldFlagsGiven = FIELD_OPTION_KEYS.some((key) => options[key] !== undefined);
    const wantsEditor = options.edit === true || (options.edit !== false && !fieldFlagsGiven);

    if (!wantsEditor && !fieldFlagsGiven) {
      throw new UsageError(
        'No fields given and --no-edit forbids the editor. Pass --description, --quantity and ' +
          '--unit-price (and others), or drop --no-edit.',
      );
    }

    const create = async (dto: Record<string, unknown>): Promise<void> => {
      const created = await client.post<InvoiceLineItemRecord>(`/invoices/${id}/lines`, dto);
      process.stdout.write(`Added "${created.description}" (${created.total}).\n`);
    };

    if (wantsEditor) {
      const initial = buildTemplate({
        schema: INVOICE_LINE_CREATE_SCHEMA,
        header: INVOICE_LINE_TEMPLATE_HEADER,
      });
      await this.editor.run({
        initial,
        filetype: 'md',
        submit: async (doc) => {
          await create({ ...doc.fields });
        },
      });
      return;
    }

    const missing = ['description', 'quantity', 'unitPrice'].filter(
      (key) => options[key as keyof AddOptions] === undefined,
    );
    if (missing.length > 0) {
      throw new UsageError(missingFlagsMessage(missing));
    }

    const dto: Record<string, unknown> = {
      description: options.description,
      quantity: options.quantity,
      unitPrice: options.unitPrice,
    };
    if (options.unit !== undefined) dto.unit = options.unit;
    if (options.taxRatePct !== undefined) dto.taxRatePct = options.taxRatePct;
    if (options.taskId !== undefined) dto.taskId = options.taskId;
    if (options.projectId !== undefined) dto.projectId = options.projectId;

    await create(dto);
  }
}
