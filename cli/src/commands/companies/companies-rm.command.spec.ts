import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { UsageError } from '../../core/errors';
import { CompaniesRmCommand } from './companies-rm.command';

describe('CompaniesRmCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  const COMPANY_ID = 'aaaaaaaa-1111-1111-1111-111111111111';

  let get: jest.Mock;
  let del: jest.Mock;
  let clients: ClientFactory;
  let confirmPrompt: jest.Mock;
  let isTTY: jest.Mock;
  let out: string[];

  const make = () => new CompaniesRmCommand(settings, clients, confirmPrompt, isTTY);

  beforeEach(() => {
    get = jest.fn().mockResolvedValue({
      id: COMPANY_ID,
      name: 'Acme Corp',
      legalName: null,
      domain: 'acme.example',
      industry: null,
      size: null,
      website: null,
      phone: null,
      country: null,
      parentCompanyId: null,
      ownerUserId: null,
      status: 'active',
      description: null,
      taxNumber: null,
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    del = jest.fn().mockResolvedValue(undefined);
    clients = { create: () => ({ get, del }) } as unknown as ClientFactory;
    confirmPrompt = jest.fn().mockResolvedValue(true);
    isTTY = jest.fn().mockReturnValue(true);
    out = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('--yes removes without prompting', async () => {
    await make().run([COMPANY_ID], { yes: true });

    expect(confirmPrompt).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith(`/companies/${COMPANY_ID}`);
  });

  it('refuses without --yes in a non-TTY session', async () => {
    isTTY.mockReturnValue(false);

    await expect(make().run([COMPANY_ID], {})).rejects.toThrow(UsageError);
    expect(del).not.toHaveBeenCalled();
  });

  it('prompts for confirmation naming the company, then deletes when confirmed', async () => {
    await make().run([COMPANY_ID], {});

    expect(confirmPrompt).toHaveBeenCalledTimes(1);
    expect(confirmPrompt.mock.calls[0][0]).toContain('Acme Corp');
    expect(del).toHaveBeenCalledWith(`/companies/${COMPANY_ID}`);
  });

  it('aborts without deleting when the user declines', async () => {
    confirmPrompt.mockResolvedValue(false);

    await make().run([COMPANY_ID], {});

    expect(del).not.toHaveBeenCalled();
    expect(out.join('')).toContain('Aborted');
  });
});
