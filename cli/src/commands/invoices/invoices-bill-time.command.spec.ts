import { readFileSync, writeFileSync } from 'node:fs';
import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { EditorService, type EditSessionOptions } from '../../core/editor/editor.service';
import { ApiError, UsageError } from '../../core/errors';
import { InvoicesBillTimeCommand } from './invoices-bill-time.command';

describe('InvoicesBillTimeCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let post: jest.Mock;
  let clients: ClientFactory;
  let editorRun: jest.Mock;
  let editor: EditorService;
  let out: string[];

  const make = () => new InvoicesBillTimeCommand(settings, clients, editor);

  beforeEach(() => {
    post = jest
      .fn()
      .mockResolvedValue({ id: 'bbbbbbbb-2222-2222-2222-222222222222', description: 'Billed time', total: '600.0000' });
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

    await make().run(['aaaaaaaa-1111-1111-1111-111111111111'], {});

    expect(editorRun).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
    expect((editorRun.mock.calls[0][0] as EditSessionOptions).initial).toContain('timeEntryIds:');
  });

  it('submits the parsed document to /invoices/{id}/bill-time', async () => {
    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      await opts.submit({
        fields: { projectId: 'proj-1', timeEntryIds: ['t1', 't2'], description: 'Billed time', unitPrice: '60.00' },
        body: '',
      });
    });

    await make().run(['aaaaaaaa-1111-1111-1111-111111111111'], {});

    expect(post).toHaveBeenCalledWith('/invoices/aaaaaaaa-1111-1111-1111-111111111111/bill-time', {
      projectId: 'proj-1',
      timeEntryIds: ['t1', 't2'],
      description: 'Billed time',
      unitPrice: '60.00',
    });
    expect(out.join('')).toContain('600.0000');
  });

  it('--time-entries maps a comma-separated list to a timeEntryIds array, and skips the editor', async () => {
    await make().run(['aaaaaaaa-1111-1111-1111-111111111111'], {
      projectId: 'proj-1',
      timeEntries: 't1, t2',
      description: 'Billed time',
      unitPrice: '60.00',
    });

    expect(editorRun).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/invoices/aaaaaaaa-1111-1111-1111-111111111111/bill-time', {
      projectId: 'proj-1',
      timeEntryIds: ['t1', 't2'],
      description: 'Billed time',
      unitPrice: '60.00',
    });
  });

  it('--no-edit with no field flags refuses rather than opening the editor', async () => {
    await expect(make().run(['aaaaaaaa-1111-1111-1111-111111111111'], { edit: false })).rejects.toThrow(UsageError);
    expect(editorRun).not.toHaveBeenCalled();
  });

  it('requires projectId/timeEntries/description/unitPrice in flag mode, naming the real flags', async () => {
    const rejection: UsageError = await make()
      .run(['aaaaaaaa-1111-1111-1111-111111111111'], { projectId: 'proj-1' })
      .catch((err) => err);

    expect(rejection).toBeInstanceOf(UsageError);
    expect(rejection.message).toBe(
      'Missing required flag(s): --time-entries, --description, --unit-price.',
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('a 400 with issues re-opens the buffer rather than crashing', async () => {
    const issue = { path: ['timeEntryIds'], message: 'Array must contain at least 1 element(s)' };
    post
      .mockRejectedValueOnce(new ApiError(400, 'VALIDATION_FAILED', 'Validation failed', [issue]))
      .mockResolvedValueOnce({ id: 'bbbbbbbb-2222-2222-2222-222222222222', description: 'Billed time', total: '0' });

    const reads: string[] = [];
    let round = 0;
    const launch = async (_cmd: string, file: string): Promise<number> => {
      round += 1;
      reads.push(readFileSync(file, 'utf-8'));
      if (round === 1) {
        writeFileSync(
          file,
          reads[0]
            .replace('\nprojectId:', '\nprojectId: proj-1')
            .replace('\ndescription:', '\ndescription: Billed time')
            .replace('\nunitPrice:', '\nunitPrice: 60.00'),
        );
      } else {
        writeFileSync(file, reads[1].replace('timeEntryIds: []', 'timeEntryIds: [t1]'));
      }
      return 0;
    };

    const realEditor = new EditorService({ launch, env: {} });
    await new InvoicesBillTimeCommand(settings, clients, realEditor).run(
      ['aaaaaaaa-1111-1111-1111-111111111111'],
      {},
    );

    expect(post).toHaveBeenCalledTimes(2);
    expect(reads[1]).toContain('Array must contain at least 1 element(s)');
  });

  it('resolves an invoice number to its id before billing', async () => {
    const get = jest.fn().mockResolvedValue({
      data: [{ id: 'aaaaaaaa-1111-1111-1111-111111111111', number: 'INV-2026-0001' }],
      total: 1,
      page: 1,
      limit: 100,
    });
    clients = { create: () => ({ get, post }) } as unknown as ClientFactory;

    await make().run(['INV-2026-0001'], {
      projectId: 'proj-1',
      timeEntries: 't1',
      description: 'Billed time',
      unitPrice: '60.00',
    });

    expect(post).toHaveBeenCalledWith(
      '/invoices/aaaaaaaa-1111-1111-1111-111111111111/bill-time',
      expect.any(Object),
    );
  });
});
