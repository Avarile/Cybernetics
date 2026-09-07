import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import type { EditorService, EditSessionOptions } from '../../core/editor/editor.service';
import { parseDocument } from '../../core/editor/frontmatter';
import { CompaniesEditCommand } from './companies-edit.command';
import type { CompanyRecord } from './companies.helpers';

function company(overrides: Partial<CompanyRecord> = {}): CompanyRecord {
  return {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
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
    ...overrides,
  };
}

describe('CompaniesEditCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  const COMPANY_ID = 'aaaaaaaa-1111-1111-1111-111111111111';

  let get: jest.Mock;
  let patch: jest.Mock;
  let clients: ClientFactory;
  let editorRun: jest.Mock;
  let editor: EditorService;
  let out: string[];

  const make = () => new CompaniesEditCommand(settings, clients, editor);

  beforeEach(() => {
    get = jest.fn().mockResolvedValue(company());
    patch = jest.fn().mockResolvedValue(company({ name: 'Renamed' }));
    clients = { create: () => ({ get, patch }) } as unknown as ClientFactory;
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

  it('fetches the company by id and opens the editor pre-filled', async () => {
    editorRun.mockResolvedValue(undefined);

    await make().run([COMPANY_ID], {});

    expect(get).toHaveBeenCalledWith(`/companies/${COMPANY_ID}`);
    const opts = editorRun.mock.calls[0][0] as EditSessionOptions;
    expect(opts.initial).toContain('name: Acme Corp');
  });

  it('sends only the field that changed, PATCHing /companies/:id', async () => {
    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      const doc = parseDocument(opts.initial);
      doc.fields.name = 'Renamed';
      await opts.submit(doc);
    });

    await make().run([COMPANY_ID], {});

    expect(patch).toHaveBeenCalledWith(`/companies/${COMPANY_ID}`, { name: 'Renamed' });
  });

  it('prints "No changes" and does not PATCH when the document is untouched', async () => {
    editorRun.mockImplementation(async (opts: EditSessionOptions) => {
      const doc = parseDocument(opts.initial);
      await opts.submit(doc);
    });

    await make().run([COMPANY_ID], {});

    expect(patch).not.toHaveBeenCalled();
    expect(out.join('')).toContain('No changes');
  });
});
