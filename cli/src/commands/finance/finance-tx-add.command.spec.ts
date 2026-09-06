import { readFileSync, writeFileSync } from 'node:fs';
import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { EditorService, type EditSessionOptions } from '../../core/editor/editor.service';
import { ApiError, UsageError } from '../../core/errors';
import { FinanceTxAddCommand } from './finance-tx-add.command';

describe('FinanceTxAddCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let post: jest.Mock;
  let clients: ClientFactory;
  let editorRun: jest.Mock;
  let editor: EditorService;
  let out: string[];

  const make = () => new FinanceTxAddCommand(settings, clients, editor);

  beforeEach(() => {
    post = jest.fn().mockResolvedValue({
      id: 'aaaaaaaa-1111-1111-1111-111111111111',
      description: 'Office supplies',
      amount: '42.5000',
    });
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
    expect(opts.initial).toContain('amount:');
    expect(opts.initial).toContain('accountId:');
  });

  it('submits the parsed document from the editor, unmodified strings', async () => {
    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      await opts.submit({
        fields: {
          kind: 'expense',
          occurredOn: '2026-01-15',
          amount: '42.5000',
          currency: 'USD',
          accountId: 'aaaaaaaa-1111-1111-1111-111111111111',
          description: 'Office supplies',
        },
        body: '',
      });
    });

    await make().run([], {});

    expect(post).toHaveBeenCalledWith('/finance/transactions', {
      kind: 'expense',
      occurredOn: '2026-01-15',
      amount: '42.5000',
      currency: 'USD',
      accountId: 'aaaaaaaa-1111-1111-1111-111111111111',
      description: 'Office supplies',
    });
    expect(out.join('')).toContain('42.5000');
  });

  it('skips the editor when field flags are given', async () => {
    await make().run([], {
      kind: 'expense',
      occurredOn: '2026-01-15',
      amount: '42.5000',
      currency: 'USD',
      accountId: 'aaaaaaaa-1111-1111-1111-111111111111',
      description: 'Office supplies',
    });

    expect(editorRun).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/finance/transactions', {
      kind: 'expense',
      occurredOn: '2026-01-15',
      amount: '42.5000',
      currency: 'USD',
      accountId: 'aaaaaaaa-1111-1111-1111-111111111111',
      description: 'Office supplies',
    });
  });

  it('--edit forces the editor even when field flags are given', async () => {
    editorRun.mockResolvedValue(undefined);

    await make().run([], {
      kind: 'expense',
      occurredOn: '2026-01-15',
      amount: '42.5000',
      currency: 'USD',
      accountId: 'a',
      description: 'x',
      edit: true,
    });

    expect(editorRun).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });

  it('--no-edit with no field flags refuses rather than opening the editor', async () => {
    await expect(make().run([], { edit: false })).rejects.toThrow(UsageError);
    expect(editorRun).not.toHaveBeenCalled();
  });

  it('requires kind/occurredOn/amount/currency/accountId/description in flag mode, naming the real flags', async () => {
    const rejection: UsageError = await make()
      .run([], { kind: 'expense' })
      .catch((err) => err);

    expect(rejection).toBeInstanceOf(UsageError);
    expect(rejection.message).toBe(
      'Missing required flag(s): --occurred-on, --amount, --currency, --account-id, --description.',
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('maps every optional flag through untouched, as strings', async () => {
    await make().run([], {
      kind: 'transfer',
      occurredOn: '2026-01-15',
      amount: '10.0000',
      currency: 'USD',
      accountId: 'acct-1',
      description: 'Move funds',
      counterAccountId: 'acct-2',
      categoryId: 'cat-1',
      projectId: 'proj-1',
      taskId: 'task-1',
      contactId: 'contact-1',
      companyId: 'company-1',
      reference: 'ref-1',
      status: 'pending',
      baseAmount: '10.0000',
      fxRate: '1.0',
    });

    expect(post).toHaveBeenCalledWith('/finance/transactions', {
      kind: 'transfer',
      occurredOn: '2026-01-15',
      amount: '10.0000',
      currency: 'USD',
      accountId: 'acct-1',
      description: 'Move funds',
      counterAccountId: 'acct-2',
      categoryId: 'cat-1',
      projectId: 'proj-1',
      taskId: 'task-1',
      contactId: 'contact-1',
      companyId: 'company-1',
      reference: 'ref-1',
      status: 'pending',
      baseAmount: '10.0000',
      fxRate: '1.0',
    });
  });

  // The trap this project has hit before, again: a transfer needing
  // counterAccountId (and counterAccountId !== accountId) is a cross-field
  // `.superRefine()` on CreateTransactionDto that does not survive to JSON
  // Schema (confirmed against src/generated/schemas.ts — no such conditional
  // constraint appears), so a submission missing it 400s and must re-open the
  // buffer annotated, not crash. Exercises the real EditorService end to end.
  it('a 400 from the transfer cross-field rule re-opens the buffer annotated, rather than crashing', async () => {
    const issue = { path: ['counterAccountId'], message: 'A transfer needs the account it moves to' };
    post
      .mockRejectedValueOnce(new ApiError(400, 'VALIDATION_FAILED', 'Validation failed', [issue]))
      .mockResolvedValueOnce({ id: 'aaaaaaaa-1111-1111-1111-111111111111', description: 'x', amount: '10.0000' });

    const reads: string[] = [];
    let round = 0;
    const launch = async (_cmd: string, file: string): Promise<number> => {
      round += 1;
      reads.push(readFileSync(file, 'utf-8'));
      if (round === 1) {
        // Anchored on a leading newline: FINANCE_TX_TEMPLATE_HEADER's own
        // prose mentions "kind:"/"accountId:" in plain sentences, so an
        // unanchored replace could rewrite the header comment instead of the
        // frontmatter field it actually shares a name with.
        writeFileSync(
          file,
          reads[0]
            .replace('\nkind:', '\nkind: transfer')
            .replace('\noccurredOn:', '\noccurredOn: 2026-01-15')
            .replace('\namount:', '\namount: 10.0000')
            .replace('\ncurrency:', '\ncurrency: USD')
            .replace('\naccountId:', '\naccountId: aaaaaaaa-1111-1111-1111-111111111111')
            .replace('\ndescription:', '\ndescription: x'),
        );
      } else {
        writeFileSync(
          file,
          reads[1].replace('# counterAccountId:', 'counterAccountId: bbbbbbbb-2222-2222-2222-222222222222'),
        );
      }
      return 0;
    };

    const realEditor = new EditorService({ launch, env: {} });
    await new FinanceTxAddCommand(settings, clients, realEditor).run([], {});

    expect(post).toHaveBeenCalledTimes(2);
    expect(reads[1]).toContain('A transfer needs the account it moves to');
    expect(out.join('')).toContain('10.0000');
  });
});
