import { Command, CommandRunner, Option, SubCommand } from 'nest-commander';
import { ConfigStore } from '../../core/config/config.store';
import { UsageError } from '../../core/errors';

interface AddOptions {
  api: string;
  email?: string;
  use?: boolean;
}

// Profile names become keys on plain objects (ConfigStore's `profiles` map,
// TokenStore's per-profile credential map). `__proto__`, `constructor` and
// `prototype` are rejected explicitly because assigning through them
// reassigns the object's prototype instead of storing an entry -- a bracket
// check like `name in obj` would already be true for these before any
// profile named that way is ever added, so they must be named outright
// rather than caught by the pattern below alone.
const RESERVED_PROFILE_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const PROFILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function assertValidProfileName(name: string): void {
  if (RESERVED_PROFILE_NAMES.has(name) || !PROFILE_NAME_PATTERN.test(name)) {
    throw new UsageError(
      `Invalid profile name "${name}". Profile names must match ${PROFILE_NAME_PATTERN} ` +
        `and may not be "__proto__", "constructor" or "prototype".`,
    );
  }
}

@SubCommand({ name: 'add', arguments: '<name>', description: 'Add or update a profile' })
export class ProfileAddCommand extends CommandRunner {
  constructor(private readonly config: ConfigStore) {
    super();
  }

  @Option({ flags: '--api <url>', description: 'API base URL', required: true })
  parseApi(v: string): string {
    return v;
  }

  @Option({ flags: '--email <email>', description: 'Default login email' })
  parseEmail(v: string): string {
    return v;
  }

  @Option({ flags: '--use', description: 'Make this the current profile' })
  parseUse(): boolean {
    return true;
  }

  async run(params: string[], options: AddOptions): Promise<void> {
    const [name] = params;
    assertValidProfileName(name);
    const cfg = this.config.read();
    cfg.profiles[name] = { baseUrl: options.api, email: options.email };
    if (options.use || Object.keys(cfg.profiles).length === 1) {
      cfg.currentProfile = name;
    }
    this.config.write(cfg);
    process.stdout.write(`Profile "${name}" saved.\n`);
  }
}

@SubCommand({ name: 'use', arguments: '<name>', description: 'Switch profile' })
export class ProfileUseCommand extends CommandRunner {
  constructor(private readonly config: ConfigStore) {
    super();
  }

  async run(params: string[]): Promise<void> {
    const [name] = params;
    const cfg = this.config.read();
    if (!cfg.profiles[name]) {
      throw new UsageError(
        `Unknown profile "${name}". Add it with: cyb config profile add ${name} --api <url>`,
      );
    }
    cfg.currentProfile = name;
    this.config.write(cfg);
    process.stdout.write(`Now using "${name}".\n`);
  }
}

@SubCommand({ name: 'ls', description: 'List profiles' })
export class ProfileListCommand extends CommandRunner {
  constructor(private readonly config: ConfigStore) {
    super();
  }

  async run(): Promise<void> {
    const cfg = this.config.read();
    const names = Object.keys(cfg.profiles);
    if (names.length === 0) {
      process.stdout.write('No profiles. Add one with: cyb config profile add\n');
      return;
    }
    for (const name of names) {
      const marker = name === cfg.currentProfile ? '*' : ' ';
      process.stdout.write(`${marker} ${name}\t${cfg.profiles[name].baseUrl}\n`);
    }
  }
}

@SubCommand({
  name: 'profile',
  description: 'Manage profiles',
  subCommands: [ProfileAddCommand, ProfileUseCommand, ProfileListCommand],
})
export class ProfileCommand extends CommandRunner {
  async run(): Promise<void> {
    this.command.help();
  }
}

@Command({
  name: 'config',
  description: 'CLI configuration',
  subCommands: [ProfileCommand],
})
export class ConfigCommand extends CommandRunner {
  async run(): Promise<void> {
    this.command.help();
  }
}
