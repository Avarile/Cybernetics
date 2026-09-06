import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { InvoicesLsCommand } from './invoices-ls.command';
import type { InvoiceRecord } from './invoices.helpers';

function row(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    number: 'DRAFT-1700000000000',
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
    status: 'draft',
    billToSnapshot: { kind: 'contact', name: 'Ada Lovelace', email: 'ada@example.com' },
    notes: null,
    terms: null,
    pdfFileId: null,
    sentAt: null,
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

describe('InvoicesLsCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new InvoicesLsCommand(settings, clients);

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

  it('renders NUMBER, STATUS, DUE, TOTAL (right-aligned decimal string), CURRENCY, CONTACT from the bill-to snapshot', async () => {
    get.mockResolvedValue({ data: [row()], total: 1, page: 1, limit: 20 });

    await make().run([], {});

    const text = out.join('');
    expect(text).toContain('NUMBER');
    expect(text).toContain('STATUS');
    expect(text).toContain('DUE');
    expect(text).toContain('TOTAL');
    expect(text).toContain('CURRENCY');
    expect(text).toContain('CONTACT');
    expect(text).toContain('DRAFT-1700000000000');
    expect(text).toContain('draft');
    expect(text).toContain('2026-01-31');
    expect(text).toContain('1080.0000');
    expect(text).toContain('Ada Lovelace');
    // Never a bare contactId in the human table — see invoices.helpers.ts's billToName.
    expect(text).not.toContain('cccccccc-3333-3333-3333-333333333333');
  });

  it('passes filters through as query params', async () => {
    get.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });

    await make().run([], {
      status: 'sent',
      contactId: 'contact-1',
      companyId: 'company-1',
      projectId: 'proj-1',
      page: 2,
      limit: 5,
    });

    const calledPath = get.mock.calls[0][0] as string;
    expect(calledPath).toContain('status=sent');
    expect(calledPath).toContain('contactId=contact-1');
    expect(calledPath).toContain('companyId=company-1');
    expect(calledPath).toContain('projectId=proj-1');
    expect(calledPath).toContain('page=2');
    expect(calledPath).toContain('limit=5');
  });

  it('prints an empty-state message when there are no invoices', async () => {
    get.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });

    await make().run([], {});

    expect(out.join('')).toContain('No invoices');
  });

  it('--json emits the raw envelope, unmodified', async () => {
    const envelope = { data: [row()], total: 1, page: 1, limit: 20 };
    get.mockResolvedValue(envelope);

    await make().run([], { json: true });

    expect(get).toHaveBeenCalledTimes(1);
    expect(JSON.parse(out.join(''))).toEqual(envelope);
  });

  it('announces rows left on later pages rather than staying silent', async () => {
    get.mockResolvedValue({ data: [row()], total: 3, page: 1, limit: 1 });

    await make().run([], {});

    expect(out.join('')).toContain('2 more record');
  });
});
