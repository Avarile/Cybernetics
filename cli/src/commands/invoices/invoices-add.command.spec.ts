import { readFileSync, writeFileSync } from 'node:fs';
import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { EditorService, type EditSessionOptions } from '../../core/editor/editor.service';
import { ApiError, UsageError } from '../../core/errors';
import { InvoicesAddCommand } from './invoices-add.command';

describe('InvoicesAddCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let post: jest.Mock;
  let clients: ClientFactory;
  let editorRun: jest.Mock;
  let editor: EditorService;
  let out: string[];

  const make = () => new InvoicesAddCommand(settings, clients, editor);

  beforeEach(() => {
    post = jest.fn().mockResolvedValue({ id: 'aaaaaaaa-1111-1111-1111-111111111111', number: 'DRAFT-1' });
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
    expect(opts.initial).toContain('issueDate:');
  });

  it('submits the parsed document, mapping the body to notes', async () => {
    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      await opts.submit({
        fields: { contactId: 'contact-1', issueDate: '2026-01-01', dueDate: '2026-01-31', currency: 'USD' },
        body: 'Thanks for your business',
      });
    });

    await make().run([], {});

    expect(post).toHaveBeenCalledWith('/invoices', {
      contactId: 'contact-1',
      issueDate: '2026-01-01',
      dueDate: '2026-01-31',
      currency: 'USD',
      notes: 'Thanks for your business',
    });
  });

  it('skips the editor when field flags are given', async () => {
    await make().run([], { contactId: 'contact-1', issueDate: '2026-01-01', dueDate: '2026-01-31', currency: 'USD' });

    expect(editorRun).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/invoices', {
      contactId: 'contact-1',
      issueDate: '2026-01-01',
      dueDate: '2026-01-31',
      currency: 'USD',
    });
  });

  it('--no-edit with no field flags refuses rather than opening the editor', async () => {
    await expect(make().run([], { edit: false })).rejects.toThrow(UsageError);
    expect(editorRun).not.toHaveBeenCalled();
  });

  it('requires issueDate/dueDate/currency in flag mode, naming the real flags', async () => {
    const rejection: UsageError = await make()
      .run([], { contactId: 'contact-1' })
      .catch((err) => err);

    expect(rejection).toBeInstanceOf(UsageError);
    expect(rejection.message).toBe('Missing required flag(s): --issue-date, --due-date, --currency.');
    expect(post).not.toHaveBeenCalled();
  });

  // The trap this project has hit before, again: CreateInvoiceDto's
  // cross-field rule ("An invoice needs a bill-to contact or company") does
  // not survive to JSON Schema (confirmed against src/generated/schemas.ts —
  // no such constraint appears), so a submission with neither 400s and must
  // re-open the buffer annotated, not crash.
  it('a 400 from the contact-or-company cross-field rule re-opens the buffer annotated, rather than crashing', async () => {
    const issue = { path: ['contactId'], message: 'An invoice needs a bill-to contact or company' };
    post
      .mockRejectedValueOnce(new ApiError(400, 'VALIDATION_FAILED', 'Validation failed', [issue]))
      .mockResolvedValueOnce({ id: 'aaaaaaaa-1111-1111-1111-111111111111', number: 'DRAFT-1' });

    const reads: string[] = [];
    let round = 0;
    const launch = async (_cmd: string, file: string): Promise<number> => {
      round += 1;
      reads.push(readFileSync(file, 'utf-8'));
      if (round === 1) {
        writeFileSync(
          file,
          reads[0]
            .replace('\nissueDate:', '\nissueDate: 2026-01-01')
            .replace('\ndueDate:', '\ndueDate: 2026-01-31')
            .replace('\ncurrency:', '\ncurrency: USD'),
        );
      } else {
        writeFileSync(file, reads[1].replace('# contactId:', 'contactId: contact-1'));
      }
      return 0;
    };

    const realEditor = new EditorService({ launch, env: {} });
    await new InvoicesAddCommand(settings, clients, realEditor).run([], {});

    expect(post).toHaveBeenCalledTimes(2);
    expect(reads[1]).toContain('An invoice needs a bill-to contact or company');
  });
});
