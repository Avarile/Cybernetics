import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { KnowledgePublishCommand } from './knowledge-publish.command';

describe('KnowledgePublishCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let post: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new KnowledgePublishCommand(settings, clients);

  beforeEach(() => {
    get = jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 100 });
    post = jest.fn().mockResolvedValue({ slug: 'a-title', status: 'published' });
    clients = { create: () => ({ get, post }) } as unknown as ClientFactory;
    out = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('defaults --status to published', async () => {
    await make().run(['aaaaaaaa-1111-1111-1111-111111111111'], {});

    expect(post).toHaveBeenCalledWith('/knowledge/aaaaaaaa-1111-1111-1111-111111111111/status', {
      status: 'published',
    });
  });

  it('sends an explicit --status and --note', async () => {
    await make().run(['aaaaaaaa-1111-1111-1111-111111111111'], {
      status: 'archived',
      note: 'superseded',
    });

    expect(post).toHaveBeenCalledWith('/knowledge/aaaaaaaa-1111-1111-1111-111111111111/status', {
      status: 'archived',
      note: 'superseded',
    });
  });

  it('prints the resulting status', async () => {
    await make().run(['aaaaaaaa-1111-1111-1111-111111111111'], {});
    expect(out.join('')).toContain('published');
  });
});
