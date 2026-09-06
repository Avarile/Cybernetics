import { readFileSync, writeFileSync } from 'node:fs';
import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { EditorService, type EditSessionOptions } from '../../core/editor/editor.service';
import { ApiError, UsageError } from '../../core/errors';
import { FinanceAccountsAddCommand } from './finance-accounts-add.command';

describe('FinanceAccountsAddCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let post: jest.Mock;
  let clients: ClientFactory;
  let editorRun: jest.Mock;
  let editor: EditorService;
  let out: string[];

  const make = () => new FinanceAccountsAddCommand(settings, clients, editor);

  beforeEach(() => {
    post = jest.fn().mockResolvedValue({ id: 'aaaaaaaa-1111-1111-1111-111111111111', name: 'Operating' });
    clients = { create: () => ({ post }) } as unknown as ClientFactory;
    editorRun = jest.fn();
    editor = { run: editorRun } as unknown as EditorService;
    out = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('opens the editor when no field flags are given', async () => {
    editorRun.mockResolvedValue(undefined);

    await make().run([], {});

    expect(editorRun).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
    const opts = editorRun.mock.calls[0][0] as EditSessionOptions;
    expect(opts.filetype).toBe('md');
    expect(opts.initial).toContain('name:');
    expect(opts.initial).toContain('currency:');
  });

  it('submits the parsed document from the editor', async () => {
    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      await opts.submit({ fields: { name: 'Operating', currency: 'USD' }, body: '' });
    });

    await make().run([], {});

    expect(post).toHaveBeenCalledWith('/finance/accounts', { name: 'Operating', currency: 'USD' });
    expect(out.join('')).toContain('Operating');
  });

  it('skips the editor when field flags are given', async () => {
    await make().run([], { name: 'Operating', currency: 'usd' });

    expect(editorRun).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/finance/accounts', { name: 'Operating', currency: 'usd' });
  });

  it('--edit forces the editor even when field flags are given', async () => {
    editorRun.mockResolvedValue(undefined);

    await make().run([], { name: 'Operating', currency: 'USD', edit: true });

    expect(editorRun).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });

  it('--no-edit with no field flags refuses rather than opening the editor', async () => {
    await expect(make().run([], { edit: false })).rejects.toThrow(UsageError);
    expect(editorRun).not.toHaveBeenCalled();
  });

  it('requires --name and --currency in flag mode', async () => {
    await expect(make().run([], { name: 'Operating' })).rejects.toThrow(UsageError);
    await expect(make().run([], { currency: 'USD' })).rejects.toThrow(UsageError);
    expect(post).not.toHaveBeenCalled();
  });

  it('maps every optional flag through untouched', async () => {
    await make().run([], {
      name: 'Operating',
      currency: 'USD',
      kind: 'bank',
      openingBalance: '150.00',
      institution: 'Big Bank',
      accountRef: 'xxxx1234',
    });

    expect(post).toHaveBeenCalledWith('/finance/accounts', {
      name: 'Operating',
      currency: 'USD',
      kind: 'bank',
      openingBalance: '150.00',
      institution: 'Big Bank',
      accountRef: 'xxxx1234',
    });
  });

  it('a 400 with issues re-opens the buffer rather than crashing', async () => {
    const issue = { path: ['currency'], message: 'Unknown currency "ZZZ"' };
    post
      .mockRejectedValueOnce(new ApiError(400, 'VALIDATION_FAILED', 'Validation failed', [issue]))
      .mockResolvedValueOnce({ id: 'aaaaaaaa-1111-1111-1111-111111111111', name: 'Operating' });

    const reads: string[] = [];
    let round = 0;
    const launch = async (_cmd: string, file: string): Promise<number> => {
      round += 1;
      reads.push(readFileSync(file, 'utf-8'));
      if (round === 1) {
        // name/currency are both required, so buildTemplate leaves them
        // uncommented (see CreateAccountDto's `required` array) — filling
        // them in is enough to submit.
        writeFileSync(file, reads[0].replace('name:', 'name: Operating').replace('currency:', 'currency: ZZZ'));
      } else {
        writeFileSync(file, reads[1].replace('currency: ZZZ', 'currency: USD'));
      }
      return 0;
    };

    const realEditor = new EditorService({ launch, env: {} });
    await new FinanceAccountsAddCommand(settings, clients, realEditor).run([], {});

    expect(post).toHaveBeenCalledTimes(2);
    expect(reads[1]).toContain('Unknown currency');
    expect(out.join('')).toContain('Operating');
  });
});
