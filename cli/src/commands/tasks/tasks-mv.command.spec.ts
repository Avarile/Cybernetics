import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import { TasksMvCommand } from './tasks-mv.command';

describe('TasksMvCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  const TASK_ID = 'eeeeeeee-5555-5555-5555-555555555555';

  let get: jest.Mock;
  let post: jest.Mock;
  let clients: ClientFactory;
  let out: string[];

  const make = () => new TasksMvCommand(settings, clients);

  beforeEach(() => {
    get = jest.fn();
    post = jest.fn().mockResolvedValue({ title: 'Ship the thing', status: 'in_progress' });
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

  it('passes a well-formed UUID straight through and posts the status change', async () => {
    await make().run([TASK_ID], { status: 'in_progress' });

    expect(get).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(`/tasks/${TASK_ID}/move`, { status: 'in_progress' });
    expect(out.join('')).toContain('Ship the thing');
  });

  it('resolves --after as a task address (KEY-NUMBER) to an id', async () => {
    get
      // lookupProjectByKey('CYB') for the moved task's address resolution — none needed, TASK_ID is a UUID
      // lookupProjectByKey('CYB') for --after's address resolution
      .mockResolvedValueOnce({
        data: [{ id: 'aaaaaaaa-1111-1111-1111-111111111111', key: 'CYB', name: 'Cybernetics' }],
        total: 1,
        page: 1,
        limit: 100,
      })
      .mockResolvedValueOnce({
        data: [{ id: 'ffffffff-6666-6666-6666-666666666666', number: 3, title: 'Anchor task', projectId: 'aaaaaaaa-1111-1111-1111-111111111111' }],
        total: 1,
        page: 1,
        limit: 25,
      });

    await make().run([TASK_ID], { after: 'CYB-3' });

    expect(post).toHaveBeenCalledWith(`/tasks/${TASK_ID}/move`, {
      afterTaskId: 'ffffffff-6666-6666-6666-666666666666',
    });
  });

  it('sends no body fields when neither --status nor --after are given (top of column)', async () => {
    await make().run([TASK_ID], {});

    expect(post).toHaveBeenCalledWith(`/tasks/${TASK_ID}/move`, {});
  });
});
