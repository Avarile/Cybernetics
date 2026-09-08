import { Injectable, Optional } from '@nestjs/common';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { UsageError } from '../errors';
import { configDir, configPath } from './paths';

export interface Profile {
  baseUrl: string;
  email?: string;
}

export interface CliConfig {
  currentProfile: string;
  profiles: Record<string, Profile>;
  editor?: string;
  output?: 'table' | 'json' | 'yaml';
}

export const DEFAULT_CONFIG: CliConfig = {
  currentProfile: 'default',
  profiles: {},
};

@Injectable()
export class ConfigStore {
  // @Optional() is required, not stylistic: with emitDecoratorMetadata an
  // interface-typed param is emitted as `Object`, which Nest cannot resolve.
  // Marked optional it receives undefined, and the default below applies.
  constructor(@Optional() private readonly env: NodeJS.ProcessEnv = process.env) {}

  read(): CliConfig {
    const path = configPath(this.env);
    let raw: string;
    try {
      raw = readFileSync(path, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ...DEFAULT_CONFIG, profiles: {} };
      }
      throw err;
    }
    try {
      return JSON.parse(raw) as CliConfig;
    } catch {
      // The raw SyntaxError names neither the file nor the fix. UsageError
      // rather than Error because this one does both, so it exits 2 — not 1,
      // which means "something we did not expect".
      throw new UsageError(`${path} is not valid JSON. Fix or delete it.`);
    }
  }

  write(cfg: CliConfig): void {
    const path = configPath(this.env);
    mkdirSync(configDir(this.env), { recursive: true, mode: 0o700 });
    // Write-then-rename so an interrupted write cannot leave a truncated file
    // where the next read expects valid JSON.
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o644 });
    renameSync(tmp, path);
  }
}
