import 'reflect-metadata';
import { CommandFactory, CommandRunnerService } from 'nest-commander';
// Read from package.json rather than a hardcoded literal so this can't drift
// from the version `pnpm build` and `npm publish` actually ship.
import { version } from '../package.json';
import { AppModule } from './app.module';
import { prepareCommandTree, type CommanderCommand } from './core/cli/commander-tree';
import { ExitCode, reportError } from './core/errors';

/**
 * Commander calls this synchronously (via exitOverride) for conditions it
 * detects and reports itself — an unknown command, a missing or invalid flag,
 * --help, --version — always AFTER it has already written its own output. If
 * it returned normally, Commander would immediately call `process.exit()`
 * itself with its own exit code (1 for a real error, 0 for help/version),
 * which both bypasses reportError's mapping to ExitCode.Usage and can't be
 * intercepted after the fact. Rethrowing turns that fallthrough
 * process.exit() into a rejected parseAsync() promise instead, which routes
 * the error to serviceErrorHandler — it recognises the already-printed shape
 * and sets the right exit code without printing the message a second time.
 */
const rethrow = (err: unknown): never => {
  throw err;
};

async function bootstrap(): Promise<void> {
  // CommandFactory.run() offers no hook between building the command tree and
  // parsing argv, and the tree has to exist before these settings can be
  // applied to it. create + runApplication is the same sequence run() uses.
  const app = await CommandFactory.createWithoutRunning(AppModule, {
    // Nest's banner and provider logs are noise in a CLI; errors still surface
    // through the handler below.
    logger: false,
    // Without this, nest-commander never registers -V/--version at all, and
    // Commander treats the flag as an unknown option instead of printing a
    // version and exiting 0.
    version,
    errorHandler: rethrow,
    serviceErrorHandler: (err) => {
      process.exitCode = reportError(err, (s) => process.stderr.write(s));
    },
  });

  try {
    // `commander` is private to CommandRunnerService and the package exports
    // no accessor for the root command, so reaching it needs a cast. Narrow
    // and deliberate: it is the only way to reach the root and the
    // subcommands built before the factory's options are applied.
    const runner = app.get(CommandRunnerService);
    const root = (runner as unknown as { commander: CommanderCommand }).commander;
    prepareCommandTree(root, rethrow);

    await CommandFactory.runApplication(app);
  } finally {
    await app.close();
  }
}

bootstrap().catch((err: unknown) => {
  process.exitCode = reportError(err, (s) => process.stderr.write(s));
  if (process.exitCode === ExitCode.Ok) process.exitCode = ExitCode.Failure;
});
