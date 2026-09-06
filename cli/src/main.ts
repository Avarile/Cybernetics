import 'reflect-metadata';
import { CommandFactory } from 'nest-commander';
// Read from package.json rather than a hardcoded literal so this can't drift
// from the version `pnpm build` and `npm publish` actually ship.
import { version } from '../package.json';
import { AppModule } from './app.module';
import { ExitCode, reportError } from './core/errors';

async function bootstrap(): Promise<void> {
  await CommandFactory.run(AppModule, {
    // Nest's banner and provider logs are noise in a CLI; errors still surface
    // through the handler below.
    logger: false,
    // Without this, nest-commander never registers -V/--version at all, and
    // Commander treats the flag as an unknown option instead of printing a
    // version and exiting 0.
    version,
    // Commander calls this synchronously (via exitOverride) for conditions
    // it detects and reports itself — an unknown command, a missing or
    // invalid flag, --help, --version — always AFTER it has already written
    // its own output. If this returned normally, Commander would immediately
    // call `process.exit()` itself with its own exit code (1 for a real
    // error, 0 for help/version), which both bypasses reportError's mapping
    // to ExitCode.Usage and can't be intercepted after the fact. Rethrowing
    // turns that fallthrough process.exit() into a rejected parseAsync()
    // promise instead, which routes the error to serviceErrorHandler below —
    // it recognises the already-printed shape and sets the right exit code
    // without printing the message a second time.
    errorHandler: (err) => {
      throw err;
    },
    serviceErrorHandler: (err) => {
      process.exitCode = reportError(err, (s) => process.stderr.write(s));
    },
  });
}

bootstrap().catch((err: unknown) => {
  process.exitCode = reportError(err, (s) => process.stderr.write(s));
  if (process.exitCode === ExitCode.Ok) process.exitCode = ExitCode.Failure;
});
