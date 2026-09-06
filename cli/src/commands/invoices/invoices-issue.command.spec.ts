import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { InvoicesIssueCommand } from './invoices-issue.command';

describe('InvoicesIssueCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let post: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new InvoicesIssueCommand(settings, clients);

  beforeEach(() => {
    post = jest.fn().mockResolvedValue({ id: 'aaaaaaaa-1111-1111-1111-111111111111', number: 'INV-2026-0001', status: 'sent' });
    clients = { create: () => ({ post }) } as unknown as ClientFactory;
    out = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('posts to /invoices/{id}/issue with no body', async () => {
    await make().run(['aaaaaaaa-1111-1111-1111-111111111111'], {});

    expect(post).toHaveBeenCalledWith('/invoices/aaaaaaaa-1111-1111-1111-111111111111/issue');
    expect(out.join('')).toContain('INV-2026-0001');
  });

  it('resolves an invoice number to its id before issuing', async () => {
    const get = jest.fn().mockResolvedValue({
      data: [{ id: 'aaaaaaaa-1111-1111-1111-111111111111', number: 'INV-2026-0001' }],
      total: 1,
      page: 1,
      limit: 100,
    });
    clients = { create: () => ({ get, post }) } as unknown as ClientFactory;

    await make().run(['INV-2026-0001'], {});

    expect(post).toHaveBeenCalledWith('/invoices/aaaaaaaa-1111-1111-1111-111111111111/issue');
  });
});
