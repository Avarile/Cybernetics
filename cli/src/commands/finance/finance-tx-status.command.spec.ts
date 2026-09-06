import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { FinanceTxStatusCommand } from './finance-tx-status.command';

describe('FinanceTxStatusCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let post: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new FinanceTxStatusCommand(settings, clients);

  beforeEach(() => {
    post = jest.fn().mockResolvedValue({
      id: 'eeeeeeee-5555-5555-5555-555555555555',
      status: 'cleared',
      description: 'Office supplies',
    });
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

  it('posts to /finance/transactions/{id}/status/{status} with no body', async () => {
    await make().run(['eeeeeeee-5555-5555-5555-555555555555', 'cleared'], {});

    expect(post).toHaveBeenCalledWith('/finance/transactions/eeeeeeee-5555-5555-5555-555555555555/status/cleared');
    expect(out.join('')).toContain('cleared');
  });
});
