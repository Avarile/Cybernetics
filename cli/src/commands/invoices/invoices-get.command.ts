import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';
import { renderTable } from '../../core/render/table';
import { AddressResolver, invoiceByNumber } from '../../core/resolve/resolver';
import { billToName, type InvoiceDetail } from './invoices.helpers';

interface GetOptions {
  profile?: string;
  api?: string;
  json?: boolean;
}

@SubCommand({
  name: 'get',
  arguments: '<addr>',
  description: 'Show an invoice with its lines and payments (accepts a number, e.g. INV-2026-0001)',
})
export class InvoicesGetCommand extends CommandRunner {
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

  @Option({ flags: '--json', description: 'Emit the raw detail object' })
  parseJson(): boolean {
    return true;
  }

  async run(params: string[], options: GetOptions): Promise<void> {
    const [addr] = params;
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const id = await new AddressResolver(client).resolve(addr, invoiceByNumber);

    // NOT a bare InvoiceRecord — `InvoiceController.get` bundles the header
    // with its line items and payments (see invoices.helpers.ts's
    // InvoiceDetail doc comment), and there is no `invoices edit`, so there
    // is no editable-template counterpart for this view to reuse.
    const detail = await client.get<InvoiceDetail>(`/invoices/${id}`);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(detail, null, 2)}\n`);
      return;
    }

    const { invoice, lineItems, payments } = detail;
    // Amounts print exactly as the API sent them — decimal strings, never
    // parsed, summed or reformatted.
    process.stdout.write(
      `${invoice.number}  [${invoice.status}]\n` +
        `  bill to: ${billToName(invoice.billToSnapshot) || '(none)'}\n` +
        `  issued:  ${invoice.issueDate}\n` +
        `  due:     ${invoice.dueDate}\n` +
        `  subtotal: ${invoice.subtotal}\n` +
        `  tax:      ${invoice.taxTotal}\n` +
        `  total:    ${invoice.total} ${invoice.currency}\n` +
        `  paid:     ${invoice.amountPaid}\n`,
    );

    if (lineItems.length > 0) {
      const table = renderTable(lineItems, [
        { header: 'DESCRIPTION', value: (l) => l.description, maxWidth: 50 },
        { header: 'QTY', value: (l) => l.quantity, align: 'right' },
        { header: 'UNIT PRICE', value: (l) => l.unitPrice, align: 'right' },
        { header: 'TAX%', value: (l) => l.taxRatePct, align: 'right' },
        { header: 'TOTAL', value: (l) => l.total, align: 'right' },
      ]);
      process.stdout.write(`\n${table}\n`);
    }

    if (payments.length > 0) {
      const table = renderTable(payments, [
        { header: 'PAID AT', value: (p) => p.paidAt },
        { header: 'AMOUNT', value: (p) => p.amount, align: 'right' },
        { header: 'CURRENCY', value: (p) => p.currency },
        { header: 'METHOD', value: (p) => p.method },
      ]);
      process.stdout.write(`\nPayments:\n${table}\n`);
    }
  }
}
