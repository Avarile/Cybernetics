import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { TokenStore } from './token.store';

const execFileAsync = promisify(execFile);
const CHILD = join(__dirname, 'refresh-race.child.ts');
const CHILDREN = 5;

describe('concurrent cyb processes', () => {
  let dir: string;
  let server: Server;
  let baseUrl: string;
  let refreshCalls: number;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'cyb-race-'));
    refreshCalls = 0;

    server = createServer((req, res) => {
      if (req.url === '/auth/refresh' && req.method === 'POST') {
        refreshCalls += 1;
        // Rotate, as the real API does.
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            accessToken: `rotated-${refreshCalls}`,
            refreshToken: `refresh-${refreshCalls}`,
            expiresIn: 900,
          }),
        );
        return;
      }
      res.writeHead(404).end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (typeof addr === 'string' || addr === null) throw new Error('no address');
    baseUrl = `http://127.0.0.1:${addr.port}`;

    // Seed an already-expired pair, so every child wants to refresh at once.
    new TokenStore({ XDG_CONFIG_HOME: dir }).write('dev', {
      accessToken: 'expired',
      refreshToken: 'refresh-0',
      expiresAt: Date.now() - 60_000,
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('refreshes exactly once across concurrent processes', async () => {
    const runs = Array.from({ length: CHILDREN }, () =>
      execFileAsync('node', ['-r', 'ts-node/register', CHILD, dir, baseUrl], {
        cwd: join(__dirname, '..', '..', '..'),
        // Five children each type-checking the whole import graph turns a
        // 3-second test into a 30-second one, and surfaces unrelated type
        // errors as lock failures.
        env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' },
      }),
    );

    const results = await Promise.all(runs);
    const tokens = results.map((r) => r.stdout.trim());

    // The whole point: a second refresh would have revoked the family.
    expect(refreshCalls).toBe(1);
    expect(new Set(tokens)).toEqual(new Set(['rotated-1']));
    expect(new TokenStore({ XDG_CONFIG_HOME: dir }).read('dev')?.refreshToken).toBe(
      'refresh-1',
    );
  }, 60_000);
});
