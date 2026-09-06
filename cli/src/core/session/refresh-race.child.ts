/**
 * Child entrypoint for refresh-race.spec.ts.
 *
 * Invoked as: node -r ts-node/register refresh-race.child.ts <configDir> <baseUrl>
 * Prints the access token it obtained, so the parent can assert every child
 * converged on the same one.
 */
import { join } from 'node:path';
import { RefreshLock } from './refresh.lock';
import { SessionService } from './session.service';
import { TokenStore } from './token.store';

async function main(): Promise<void> {
  const [configHome, baseUrl] = process.argv.slice(2);
  const env = { XDG_CONFIG_HOME: configHome } as NodeJS.ProcessEnv;
  const session = new SessionService({
    store: new TokenStore(env),
    lock: new RefreshLock(join(configHome, 'cybernetics', 'refresh.lock'), {
      pollMs: 10,
      timeoutMs: 15_000,
    }),
  });
  process.stdout.write(await session.getAccessToken('dev', baseUrl));
}

main().catch((err: Error) => {
  process.stderr.write(err.message);
  process.exit(1);
});
