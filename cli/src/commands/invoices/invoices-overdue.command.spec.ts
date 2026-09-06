import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { InvoicesOverdueCommand } from './invoices-overdue.command';
import type { InvoiceRecord } from './invoices.helpers';

function row(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    number: 'INV-2026-0001',
    contactId: 'cccccccc-3333-3333-3333-333333333333',
    companyId: null,
    projectId: null,
    issueDate: '2026-01-01',
    dueDate: '2026-01-15',
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
    ...overrides,
  };
}

describe('InvoicesOverdueCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new InvoicesOverdueCommand(settings, clients);

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

  it('renders overdue invoices with the total right-aligned', async () => {
    get.mockResolvedValue([row()]);

    await make().run([], {});

    expect(get).toHaveBeenCalledWith('/invoices/overdue');
    const text = out.join('');
    expect(text).toContain('INV-2026-0001');
    expect(text).toContain('1080.0000');
    expect(text).toContain('Ada Lovelace');
  });

  it('prints an empty-state message when nothing is overdue', async () => {
    get.mockResolvedValue([]);

    await make().run([], {});

    expect(out.join('')).toContain('No overdue invoices');
  });

  it('--json emits the raw array, unmodified', async () => {
    const rows = [row()];
    get.mockResolvedValue(rows);

    await make().run([], { json: true });

    expect(JSON.parse(out.join(''))).toEqual(rows);
  });
});
