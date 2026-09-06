import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { InvoicesGetCommand } from './invoices-get.command';
import type { InvoiceDetail } from './invoices.helpers';

function detail(): InvoiceDetail {
  return {
    invoice: {
      id: 'aaaaaaaa-1111-1111-1111-111111111111',
      number: 'INV-2026-0001',
      contactId: 'cccccccc-3333-3333-3333-333333333333',
      companyId: null,
      projectId: null,
      issueDate: '2026-01-01',
      dueDate: '2026-01-31',
      currency: 'USD',
      subtotal: '1000.0000',
      taxTotal: '80.0000',
      total: '1080.0000',
      amountPaid: '0.0000',
      status: 'sent',
      billToSnapshot: { kind: 'contact', name: 'Ada Lovelace' },
      notes: null,
      terms: null,
      pdfFileId: null,
      sentAt: '2026-01-01T00:00:00.000Z',
      paidAt: null,
      voidedAt: null,
      createdBy: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      isDeleted: false,
      deletedAt: null,
    },
    lineItems: [
      {
        id: 'dddddddd-4444-4444-4444-444444444444',
        invoiceId: 'aaaaaaaa-1111-1111-1111-111111111111',
        description: 'Consulting',
        quantity: '10.0000',
        unit: 'hour',
        unitPrice: '100.0000',
        taxRatePct: '8.000',
        amount: '1000.0000',
        taxAmount: '80.0000',
        total: '1080.0000',
        taskId: null,
        projectId: null,
        sortOrder: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        isDeleted: false,
        deletedAt: null,
      },
    ],
    payments: [],
  };
}

describe('InvoicesGetCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new InvoicesGetCommand(settings, clients);

  beforeEach(() => {
    get = jest.fn();
    clients = { create: () => ({ get }) } as unknown as ClientFactory;
    out = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches by id and prints the invoice header, line items and totals verbatim', async () => {
    get.mockResolvedValue(detail());

    await make().run(['aaaaaaaa-1111-1111-1111-111111111111'], {});

    expect(get).toHaveBeenCalledWith('/invoices/aaaaaaaa-1111-1111-1111-111111111111');
    const text = out.join('');
    expect(text).toContain('INV-2026-0001');
    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('Consulting');
    expect(text).toContain('1080.0000');
  });

  it('--json emits the raw detail object, unmodified', async () => {
    const d = detail();
    get.mockResolvedValue(d);

    await make().run(['aaaaaaaa-1111-1111-1111-111111111111'], { json: true });

    expect(JSON.parse(out.join(''))).toEqual(d);
  });

  it('resolves an invoice number to its id before fetching', async () => {
    const d = detail();
    get.mockImplementation(async (path: string) => {
      if (path.startsWith('/invoices?')) {
        return { data: [{ id: d.invoice.id, number: d.invoice.number }], total: 1, page: 1, limit: 100 };
      }
      return d;
    });

    await make().run(['INV-2026-0001'], {});

    expect(get).toHaveBeenCalledWith(`/invoices/${d.invoice.id}`);
  });
});
