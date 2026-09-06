# Cybernetics CLI — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working `cyb` CLI that authenticates against the Cybernetics API and holds a session across invocations and across concurrent shells without ever revoking itself.

**Architecture:** A standalone `cli/` pnpm package (peer to `api/` and `client/`, not a workspace member) built on nest-commander. It talks HTTP with Bearer tokens. Session state lives in a 0600 file guarded by an O_EXCL cross-process lock, because the API rotates refresh tokens and treats concurrent reuse as theft. API contracts are generated from the live OpenAPI document and committed.

**Tech Stack:** TypeScript (CommonJS), nest-commander, @nestjs/common + @nestjs/core, jest + @swc/jest, tsup, ajv, yaml, @inquirer/prompts, picocolors.

**Spec:** `docs/superpowers/specs/2026-09-06-cli-tool-design.md`

## Global Constraints

- Node `>=20`. Uses global `fetch`; do not add `node-fetch`.
- Package manager is `pnpm@10.16.1`, matching `api/package.json`.
- CommonJS output. Do **not** set `"type": "module"` — nest-commander and Nest DI are used with legacy decorators.
- `.swcrc` must set `legacyDecorator: true` and `decoratorMetadata: true`, and `tsconfig.json` must set `experimentalDecorators` and `emitDecoratorMetadata`. Nest DI fails silently without these.
- Test files are `*.spec.ts` beside their source, per `api/jest.config.js`.
- `credentials.json` is mode `0600`; `config.json` is `0644`; the config directory is `0700`.
- The refresh lock waits at most **10 000 ms**, polls every **50 ms**, and reaps a lock older than **30 000 ms** or held by a dead pid.
- Access-token expiry skew is **30 000 ms**.
- Only `AUTH_TOKEN_EXPIRED` may trigger a refresh. `AUTH_TOKEN_INVALID` and `AUTH_TOKEN_REUSE` mean the session is gone: clear credentials and exit 3.
- Exit codes: `0` ok · `1` unexpected · `2` usage/validation/ambiguous · `3` auth required · `4` not found · `5` forbidden · `6` conflict.
- Never auto-retry a rejected password: `POST /auth/login` allows 5 attempts per minute.
- Do not add a `Co-Authored-By` trailer to commits (`api/CLAUDE.md`).

## Scope

This plan covers spec sections **§4 (package layout), §5 (codegen), §6 (session), §10 (exit codes)** and the auth slice of §9. It delivers `cyb login`, `cyb logout`, `cyb whoami`, `cyb sessions`, `cyb config profile`, plus `pnpm codegen` and the CI drift check.

Deferred to follow-up plans, in order:

- **Plan 2 — Editor + knowledge** (spec §7, §8, §10 rendering): frontmatter round-trip, JSON-Schema buffer templates, `ZodIssue` annotation, `EditorService`, address resolution, `cyb knowledge ls|get|add|edit`.
- **Plan 3 — Remaining domains** (spec §9): contacts, projects/tasks, finance, invoices.

## File Structure

| File | Responsibility |
|---|---|
| `cli/package.json` | deps, `bin: { cyb }`, scripts |
| `cli/tsconfig.json`, `cli/.swcrc`, `cli/jest.config.js`, `cli/tsup.config.ts` | toolchain, mirroring `api/` |
| `cli/src/core/config/paths.ts` | XDG-aware path resolution — pure functions |
| `cli/src/core/config/config.store.ts` | read/write `config.json` |
| `cli/src/core/session/tokens.ts` | `TokenPair` type, expiry arithmetic — pure |
| `cli/src/core/session/token.store.ts` | read/write `credentials.json`, 0600 enforcement, atomic write |
| `cli/src/core/session/refresh.lock.ts` | O_EXCL cross-process lock, stale reaping, bounded wait |
| `cli/src/core/session/session.service.ts` | orchestrates store + lock + refresh HTTP |
| `cli/src/core/errors/api-error.ts` | `ApiError` + exit-code mapping |
| `cli/src/core/errors/envelope.ts` | `ErrorEnvelope` → `ApiError` |
| `cli/src/core/http/api.client.ts` | bearer, 401 handling, 429 backoff |
| `cli/src/codegen/generate.ts` | OpenAPI → `generated/` |
| `cli/src/generated/*` | committed codegen output |
| `cli/src/commands/auth/*.command.ts` | login, logout, whoami, sessions |
| `cli/src/commands/config/profile.command.ts` | profile management |
| `cli/src/app.module.ts`, `cli/src/main.ts` | DI wiring and entrypoint |

## Task Dependency Graph

Tasks 2, 3, 4 and 7 are independent of one another and may run in parallel once Task 1 lands.

```
1 ──┬── 2 ──┐
    ├── 3 ──┼── 5 ── 6 ── 8 ── 9
    ├── 4 ──┘
    └── 7 ──────────────────────┘
```

---

### Task 1: Package scaffold and config paths

**Files:**
- Create: `cli/package.json`, `cli/tsconfig.json`, `cli/.swcrc`, `cli/jest.config.js`, `cli/tsup.config.ts`, `cli/.gitignore`
- Create: `cli/src/core/config/paths.ts`
- Create: `cli/src/core/config/config.store.ts`
- Test: `cli/src/core/config/paths.spec.ts`, `cli/src/core/config/config.store.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `configDir(env?: NodeJS.ProcessEnv): string`
  - `configPath(env?): string`, `credentialsPath(env?): string`, `lockPath(env?): string`
  - `interface Profile { baseUrl: string; email?: string }`
  - `interface CliConfig { currentProfile: string; profiles: Record<string, Profile>; editor?: string; output?: 'table' | 'json' | 'yaml' }`
  - `class ConfigStore { constructor(env?: NodeJS.ProcessEnv); read(): CliConfig; write(cfg: CliConfig): void }`

- [ ] **Step 1: Create the package manifest**

`cli/package.json`:

```json
{
  "name": "cybernetics-cli",
  "version": "0.0.1",
  "private": true,
  "packageManager": "pnpm@10.16.1",
  "engines": { "node": ">=20" },
  "bin": { "cyb": "./dist/cyb.js" },
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "test": "jest",
    "test:watch": "jest --watch",
    "codegen": "ts-node src/codegen/generate.ts",
    "verify": "pnpm typecheck && pnpm test"
  },
  "dependencies": {
    "@inquirer/prompts": "^7.2.0",
    "@nestjs/common": "^11.1.28",
    "@nestjs/core": "^11.1.28",
    "ajv": "^8.17.1",
    "ajv-formats": "^3.0.1",
    "nest-commander": "^3.19.0",
    "picocolors": "^1.1.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.2",
    "yaml": "^2.7.0"
  },
  "devDependencies": {
    "@swc/core": "^1.15.43",
    "@swc/jest": "^0.2.39",
    "@types/jest": "^30.0.0",
    "@types/node": "^26.1.1",
    "jest": "^30.4.2",
    "ts-node": "^10.9.2",
    "tsup": "^8.3.5",
    "typescript": "^5.9.3"
  }
}
```

- [ ] **Step 2: Create the toolchain configs**

`cli/tsconfig.json` (mirrors `api/tsconfig.json`):

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "target": "ES2023",
    "lib": ["ES2023"],
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "skipLibCheck": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

`cli/.swcrc` (copy of `api/.swcrc` — `legacyDecorator` and `decoratorMetadata` are required for Nest DI):

```json
{
  "$schema": "https://swc.rs/schema.json",
  "sourceMaps": true,
  "module": { "type": "commonjs" },
  "jsc": {
    "target": "es2023",
    "parser": { "syntax": "typescript", "decorators": true, "dynamicImport": true },
    "transform": { "legacyDecorator": true, "decoratorMetadata": true },
    "keepClassNames": true,
    "baseUrl": "./"
  },
  "minify": false
}
```

`cli/jest.config.js`:

```js
const fs = require('node:fs');
const path = require('node:path');

const swcConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '.swcrc'), 'utf-8'),
);

/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': ['@swc/jest', swcConfig] },
  testEnvironment: 'node',
};
```

`cli/tsup.config.ts`:

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cyb: 'src/main.ts' },
  format: ['cjs'],
  target: 'node20',
  clean: true,
  sourcemap: true,
  // Nest resolves providers by decorator metadata at runtime; minification
  // rewrites class names and breaks that resolution.
  minify: false,
  keepNames: true,
  banner: { js: '#!/usr/bin/env node' },
});
```

`cli/.gitignore`:

```
node_modules/
dist/
*.tsbuildinfo
```

- [ ] **Step 3: Install dependencies**

Run: `cd cli && pnpm install`
Expected: a `cli/pnpm-lock.yaml` is created and `node_modules/` populated.

- [ ] **Step 4: Write the failing test for path resolution**

`cli/src/core/config/paths.spec.ts`:

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import { configDir, configPath, credentialsPath, lockPath } from './paths';

describe('config paths', () => {
  it('uses XDG_CONFIG_HOME when set', () => {
    expect(configDir({ XDG_CONFIG_HOME: '/tmp/xdg' })).toBe('/tmp/xdg/cybernetics');
  });

  it('falls back to ~/.config when XDG_CONFIG_HOME is unset', () => {
    expect(configDir({})).toBe(join(homedir(), '.config', 'cybernetics'));
  });

  it('treats an empty XDG_CONFIG_HOME as unset', () => {
    // An exported-but-empty variable is common in shell profiles and would
    // otherwise resolve every path to "/cybernetics".
    expect(configDir({ XDG_CONFIG_HOME: '   ' })).toBe(
      join(homedir(), '.config', 'cybernetics'),
    );
  });

  it('derives the three file paths from the directory', () => {
    const env = { XDG_CONFIG_HOME: '/tmp/xdg' };
    expect(configPath(env)).toBe('/tmp/xdg/cybernetics/config.json');
    expect(credentialsPath(env)).toBe('/tmp/xdg/cybernetics/credentials.json');
    expect(lockPath(env)).toBe('/tmp/xdg/cybernetics/refresh.lock');
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cd cli && pnpm jest src/core/config/paths.spec.ts`
Expected: FAIL — `Cannot find module './paths'`.

- [ ] **Step 6: Implement path resolution**

`cli/src/core/config/paths.ts`:

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';

const APP_DIR = 'cybernetics';

/**
 * The CLI's configuration directory.
 *
 * `env` is a parameter rather than a direct `process.env` read so tests can
 * redirect every path without mutating global state.
 */
export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && xdg.trim() !== '' ? xdg : join(homedir(), '.config');
  return join(base, APP_DIR);
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), 'config.json');
}

export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), 'credentials.json');
}

export function lockPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), 'refresh.lock');
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd cli && pnpm jest src/core/config/paths.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 8: Write the failing test for ConfigStore**

`cli/src/core/config/config.store.spec.ts`:

```ts
import { mkdtempSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore, DEFAULT_CONFIG } from './config.store';

describe('ConfigStore', () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cyb-cfg-'));
    env = { XDG_CONFIG_HOME: dir };
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns the default config when no file exists', () => {
    expect(new ConfigStore(env).read()).toEqual(DEFAULT_CONFIG);
  });

  it('round-trips a written config', () => {
    const store = new ConfigStore(env);
    const cfg = {
      currentProfile: 'dev',
      profiles: { dev: { baseUrl: 'http://localhost:3000', email: 'a@b.co' } },
    };
    store.write(cfg);
    expect(store.read()).toEqual(cfg);
  });

  it('creates the config directory at 0700', () => {
    new ConfigStore(env).write(DEFAULT_CONFIG);
    const mode = statSync(join(dir, 'cybernetics')).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it('writes config.json at 0644', () => {
    new ConfigStore(env).write(DEFAULT_CONFIG);
    const mode = statSync(join(dir, 'cybernetics', 'config.json')).mode & 0o777;
    expect(mode).toBe(0o644);
  });

  it('throws a readable error on malformed JSON rather than a syntax error', () => {
    const store = new ConfigStore(env);
    store.write(DEFAULT_CONFIG);
    writeFileSync(join(dir, 'cybernetics', 'config.json'), '{ not json');
    expect(() => store.read()).toThrow(/is not valid JSON/);
  });
});
```

- [ ] **Step 9: Run the test to verify it fails**

Run: `cd cli && pnpm jest src/core/config/config.store.spec.ts`
Expected: FAIL — `Cannot find module './config.store'`.

- [ ] **Step 10: Implement ConfigStore**

`cli/src/core/config/config.store.ts`:

```ts
import { Injectable, Optional } from '@nestjs/common';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
      // The raw SyntaxError names neither the file nor the fix.
      throw new Error(`${path} is not valid JSON. Fix or delete it.`);
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
```

- [ ] **Step 11: Run the test to verify it passes**

Run: `cd cli && pnpm jest src/core/config`
Expected: PASS, 9 tests across both files.

- [ ] **Step 12: Commit**

```bash
git add cli/
git commit -m "feat(cli): scaffold package and config path resolution"
```

---

### Task 2: Token store with 0600 enforcement

Runs in parallel with Tasks 3, 4 and 7.

**Files:**
- Create: `cli/src/core/session/tokens.ts`
- Create: `cli/src/core/session/token.store.ts`
- Test: `cli/src/core/session/tokens.spec.ts`, `cli/src/core/session/token.store.spec.ts`

**Interfaces:**
- Consumes: `credentialsPath`, `configDir` from `../config/paths` (Task 1).
- Produces:
  - `interface TokenPair { accessToken: string; refreshToken: string; expiresAt: number }`
  - `interface LoginResponse { accessToken: string; refreshToken: string; expiresIn: number }`
  - `const EXPIRY_SKEW_MS = 30_000`
  - `isExpired(pair: TokenPair, now?: number, skewMs?: number): boolean`
  - `pairFromLogin(res: LoginResponse, now?: number): TokenPair`
  - `class TokenStore { constructor(env?: NodeJS.ProcessEnv); read(profile: string): TokenPair | null; write(profile: string, pair: TokenPair): void; clear(profile: string): void }`

- [ ] **Step 1: Write the failing test for expiry arithmetic**

`cli/src/core/session/tokens.spec.ts`:

```ts
import { EXPIRY_SKEW_MS, isExpired, pairFromLogin } from './tokens';

const pair = (expiresAt: number) => ({
  accessToken: 'a',
  refreshToken: 'r',
  expiresAt,
});

describe('isExpired', () => {
  const now = 1_000_000;

  it('is false for a token well inside its lifetime', () => {
    expect(isExpired(pair(now + 10 * 60_000), now)).toBe(false);
  });

  it('is true for a token past its expiry', () => {
    expect(isExpired(pair(now - 1), now)).toBe(true);
  });

  it('is true inside the skew window, so a token cannot expire in flight', () => {
    expect(isExpired(pair(now + EXPIRY_SKEW_MS - 1), now)).toBe(true);
  });

  it('is false just outside the skew window', () => {
    expect(isExpired(pair(now + EXPIRY_SKEW_MS + 1), now)).toBe(false);
  });
});

describe('pairFromLogin', () => {
  it('converts the API expiresIn (seconds) to an absolute ms timestamp', () => {
    const now = 1_000_000;
    expect(
      pairFromLogin(
        { accessToken: 'a', refreshToken: 'r', expiresIn: 900 },
        now,
      ),
    ).toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: now + 900_000 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cli && pnpm jest src/core/session/tokens.spec.ts`
Expected: FAIL — `Cannot find module './tokens'`.

- [ ] **Step 3: Implement the token value type**

`cli/src/core/session/tokens.ts`:

```ts
/** What the CLI persists. `expiresAt` is absolute ms, unlike the API's relative `expiresIn`. */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/** The literal body of POST /auth/login and POST /auth/refresh. */
export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Treat a token as expired this far before it actually is.
 *
 * Without the margin a token that passes the check can still expire between
 * the check and the server reading it, producing a 401 the CLI then has to
 * recover from — which costs a lock acquisition and a round trip.
 */
export const EXPIRY_SKEW_MS = 30_000;

export function isExpired(
  pair: TokenPair,
  now: number = Date.now(),
  skewMs: number = EXPIRY_SKEW_MS,
): boolean {
  return pair.expiresAt - skewMs <= now;
}

export function pairFromLogin(
  res: LoginResponse,
  now: number = Date.now(),
): TokenPair {
  return {
    accessToken: res.accessToken,
    refreshToken: res.refreshToken,
    expiresAt: now + res.expiresIn * 1000,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd cli && pnpm jest src/core/session/tokens.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing test for TokenStore**

`cli/src/core/session/token.store.spec.ts`:

```ts
import { chmodSync, mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenStore } from './token.store';

const PAIR = { accessToken: 'a', refreshToken: 'r', expiresAt: 123 };

describe('TokenStore', () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;
  let credFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cyb-tok-'));
    env = { XDG_CONFIG_HOME: dir };
    credFile = join(dir, 'cybernetics', 'credentials.json');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns null when no credentials file exists', () => {
    expect(new TokenStore(env).read('dev')).toBeNull();
  });

  it('round-trips a pair for a profile', () => {
    const store = new TokenStore(env);
    store.write('dev', PAIR);
    expect(store.read('dev')).toEqual(PAIR);
  });

  it('keeps profiles isolated', () => {
    const store = new TokenStore(env);
    store.write('dev', PAIR);
    store.write('prod', { ...PAIR, accessToken: 'other' });
    expect(store.read('dev')?.accessToken).toBe('a');
    expect(store.read('prod')?.accessToken).toBe('other');
  });

  it('returns null for a profile that has no entry', () => {
    const store = new TokenStore(env);
    store.write('dev', PAIR);
    expect(store.read('prod')).toBeNull();
  });

  it('writes credentials.json at 0600', () => {
    new TokenStore(env).write('dev', PAIR);
    expect(statSync(credFile).mode & 0o777).toBe(0o600);
  });

  it('refuses to read credentials that are group- or world-readable', () => {
    const store = new TokenStore(env);
    store.write('dev', PAIR);
    chmodSync(credFile, 0o644);
    expect(() => store.read('dev')).toThrow(/permissions are too open/);
  });

  it('clear removes only the named profile', () => {
    const store = new TokenStore(env);
    store.write('dev', PAIR);
    store.write('prod', PAIR);
    store.clear('dev');
    expect(store.read('dev')).toBeNull();
    expect(store.read('prod')).toEqual(PAIR);
  });

  it('clear on a missing file is a no-op rather than an error', () => {
    expect(() => new TokenStore(env).clear('dev')).not.toThrow();
  });

  it('never leaves a temp file behind', () => {
    const store = new TokenStore(env);
    store.write('dev', PAIR);
    const entries = readFileSync(credFile, 'utf-8');
    expect(entries).toContain('accessToken');
    expect(
      require('node:fs').readdirSync(join(dir, 'cybernetics')),
    ).toEqual(['credentials.json']);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd cli && pnpm jest src/core/session/token.store.spec.ts`
Expected: FAIL — `Cannot find module './token.store'`.

- [ ] **Step 7: Implement TokenStore**

`cli/src/core/session/token.store.ts`:

```ts
import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { configDir, credentialsPath } from '../config/paths';
import type { TokenPair } from './tokens';

type CredentialsFile = Record<string, TokenPair>;

/**
 * Persists one TokenPair per profile in a 0600 file.
 *
 * Reads assert the mode before parsing, the way ssh refuses a world-readable
 * private key: a refresh token is a bearer credential with a longer life than
 * the access token it mints, so a loosened file is a real compromise and not a
 * style violation.
 */
export class TokenStore {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  read(profile: string): TokenPair | null {
    const file = this.readFile();
    return file?.[profile] ?? null;
  }

  write(profile: string, pair: TokenPair): void {
    const file = this.readFile() ?? {};
    file[profile] = pair;
    this.writeFile(file);
  }

  clear(profile: string): void {
    const file = this.readFile();
    if (!file) return;
    delete file[profile];
    if (Object.keys(file).length === 0) {
      try {
        unlinkSync(credentialsPath(this.env));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      return;
    }
    this.writeFile(file);
  }

  private readFile(): CredentialsFile | null {
    const path = credentialsPath(this.env);
    let raw: string;
    try {
      raw = readFileSync(path, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    this.assertPrivate(path);
    try {
      return JSON.parse(raw) as CredentialsFile;
    } catch {
      throw new Error(`${path} is not valid JSON. Run \`cyb login\` again.`);
    }
  }

  private writeFile(file: CredentialsFile): void {
    const path = credentialsPath(this.env);
    mkdirSync(configDir(this.env), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${process.pid}.tmp`;
    // Mode is set at creation, not after: a chmod-after-write leaves a window
    // in which the tokens are on disk world-readable.
    writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, path);
  }

  private assertPrivate(path: string): void {
    // Windows does not model POSIX permission bits; the check would always fail.
    if (process.platform === 'win32') return;
    const mode = statSync(path).mode & 0o777;
    if (mode !== 0o600) {
      throw new Error(
        `${path} permissions are too open (${mode.toString(8)}). ` +
          `Run: chmod 600 ${path}`,
      );
    }
  }
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd cli && pnpm jest src/core/session`
Expected: PASS, 14 tests across both files.

- [ ] **Step 9: Commit**

```bash
git add cli/src/core/session/
git commit -m "feat(cli): persist tokens in a 0600 file with atomic writes"
```

---

### Task 3: Cross-process refresh lock

Runs in parallel with Tasks 2, 4 and 7. This is the highest-risk unit in the plan — the failure it prevents revokes every session the user holds.

**Files:**
- Create: `cli/src/core/session/refresh.lock.ts`
- Test: `cli/src/core/session/refresh.lock.spec.ts`

**Interfaces:**
- Consumes: nothing beyond `node:fs`.
- Produces:
  - `class LockTimeoutError extends Error`
  - `interface LockOptions { timeoutMs: number; pollMs: number; staleMs: number }`
  - `const DEFAULT_LOCK_OPTIONS: LockOptions` — `{ timeoutMs: 10_000, pollMs: 50, staleMs: 30_000 }`
  - `class RefreshLock { constructor(path: string, opts?: Partial<LockOptions>); acquire(): Promise<void>; release(): void; withLock<T>(fn: () => Promise<T>): Promise<T> }`

- [ ] **Step 1: Write the failing test**

`cli/src/core/session/refresh.lock.spec.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LockTimeoutError, RefreshLock } from './refresh.lock';

describe('RefreshLock', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cyb-lock-'));
    path = join(dir, 'refresh.lock');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('acquires an uncontended lock and creates the file', async () => {
    const lock = new RefreshLock(path);
    await lock.acquire();
    expect(existsSync(path)).toBe(true);
    lock.release();
    expect(existsSync(path)).toBe(false);
  });

  it('blocks a second holder until the first releases', async () => {
    const a = new RefreshLock(path);
    const b = new RefreshLock(path, { pollMs: 5 });
    await a.acquire();

    let acquired = false;
    const pending = b.acquire().then(() => {
      acquired = true;
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(acquired).toBe(false);

    a.release();
    await pending;
    expect(acquired).toBe(true);
    b.release();
  });

  it('times out rather than waiting forever', async () => {
    const a = new RefreshLock(path);
    const b = new RefreshLock(path, { timeoutMs: 60, pollMs: 5 });
    await a.acquire();
    await expect(b.acquire()).rejects.toBeInstanceOf(LockTimeoutError);
    a.release();
  });

  it('reaps a lock held by a pid that is no longer alive', async () => {
    // pid 2^22 is above the default pid_max on Linux and macOS, so it cannot
    // be a live process.
    writeFileSync(
      path,
      JSON.stringify({ pid: 4_194_304, at: Date.now() }),
      { mode: 0o600 },
    );
    const lock = new RefreshLock(path, { timeoutMs: 200, pollMs: 5 });
    await lock.acquire();
    lock.release();
  });

  it('reaps a lock older than staleMs even if the pid is alive', async () => {
    writeFileSync(
      path,
      JSON.stringify({ pid: process.pid, at: Date.now() - 60_000 }),
      { mode: 0o600 },
    );
    const lock = new RefreshLock(path, { timeoutMs: 200, pollMs: 5, staleMs: 1_000 });
    await lock.acquire();
    lock.release();
  });

  it('reaps a corrupt lock file rather than deadlocking on it', async () => {
    writeFileSync(path, 'not json', { mode: 0o600 });
    const lock = new RefreshLock(path, { timeoutMs: 200, pollMs: 5 });
    await lock.acquire();
    lock.release();
  });

  it('release is idempotent', async () => {
    const lock = new RefreshLock(path);
    await lock.acquire();
    lock.release();
    expect(() => lock.release()).not.toThrow();
  });

  it('withLock releases even when the body throws', async () => {
    const lock = new RefreshLock(path);
    await expect(
      lock.withLock(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(existsSync(path)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cli && pnpm jest src/core/session/refresh.lock.spec.ts`
Expected: FAIL — `Cannot find module './refresh.lock'`.

- [ ] **Step 3: Implement RefreshLock**

`cli/src/core/session/refresh.lock.ts`:

```ts
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';

export class LockTimeoutError extends Error {
  constructor(path: string, timeoutMs: number) {
    super(
      `Timed out after ${timeoutMs}ms waiting for ${path}. ` +
        `Another cyb process may be stuck; remove the file if you are sure it is not.`,
    );
    this.name = 'LockTimeoutError';
  }
}

export interface LockOptions {
  timeoutMs: number;
  pollMs: number;
  staleMs: number;
}

export const DEFAULT_LOCK_OPTIONS: LockOptions = {
  timeoutMs: 10_000,
  pollMs: 50,
  staleMs: 30_000,
};

interface LockRecord {
  pid: number;
  at: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A cross-process mutex built on O_EXCL file creation.
 *
 * Exists because the API rotates refresh tokens and treats a second use of a
 * spent one as theft, revoking the whole family. Two `cyb` invocations
 * refreshing at once would therefore log the user out of everything. `wx`
 * creation is atomic on every filesystem this CLI targets, which a
 * check-then-create pair is not.
 */
export class RefreshLock {
  private readonly opts: LockOptions;
  private held = false;

  constructor(
    private readonly path: string,
    opts: Partial<LockOptions> = {},
  ) {
    this.opts = { ...DEFAULT_LOCK_OPTIONS, ...opts };
  }

  async acquire(): Promise<void> {
    const deadline = Date.now() + this.opts.timeoutMs;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });

    for (;;) {
      if (this.tryCreate()) {
        this.held = true;
        return;
      }
      if (this.reapIfStale()) continue;
      if (Date.now() >= deadline) {
        throw new LockTimeoutError(this.path, this.opts.timeoutMs);
      }
      await sleep(this.opts.pollMs);
    }
  }

  release(): void {
    if (!this.held) return;
    this.held = false;
    try {
      unlinkSync(this.path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private tryCreate(): boolean {
    let fd: number;
    try {
      // 'wx' fails if the path exists — the atomic test-and-set.
      fd = openSync(this.path, 'wx', 0o600);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw err;
    }
    try {
      const record: LockRecord = { pid: process.pid, at: Date.now() };
      writeSync(fd, JSON.stringify(record));
    } finally {
      closeSync(fd);
    }
    return true;
  }

  /** Returns true if a dead or expired lock was removed and acquisition should retry. */
  private reapIfStale(): boolean {
    let record: LockRecord;
    try {
      record = JSON.parse(readFileSync(this.path, 'utf-8')) as LockRecord;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Released between our failed create and this read; retry immediately.
        return true;
      }
      // Unparseable content cannot identify an owner, so it can only deadlock.
      return this.remove();
    }

    const expired = Date.now() - record.at > this.opts.staleMs;
    if (expired || !isAlive(record.pid)) return this.remove();
    return false;
  }

  private remove(): boolean {
    try {
      unlinkSync(this.path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return true;
  }
}

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // Signal 0 performs the permission and existence check without delivering.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists but belongs to another user — still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd cli && pnpm jest src/core/session/refresh.lock.spec.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/session/refresh.lock.ts cli/src/core/session/refresh.lock.spec.ts
git commit -m "feat(cli): add O_EXCL cross-process refresh lock with stale reaping"
```

---

### Task 4: Error envelope and exit codes

Runs in parallel with Tasks 2, 3 and 7.

**Files:**
- Create: `cli/src/core/errors/api-error.ts`
- Create: `cli/src/core/errors/envelope.ts`
- Create: `cli/src/core/errors/index.ts`
- Test: `cli/src/core/errors/envelope.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `enum ExitCode { Ok=0, Failure=1, Usage=2, AuthRequired=3, NotFound=4, Forbidden=5, Conflict=6 }`
  - `interface ApiIssue { path: (string | number)[]; message: string; code?: string }`
  - `class ApiError extends Error { status: number; code: string; issues: ApiIssue[]; correlationId?: string; exitCode: ExitCode; isAuthExpiry(): boolean; isSessionGone(): boolean }`
  - `parseErrorEnvelope(status: number, body: unknown): ApiError`

- [ ] **Step 1: Write the failing test**

`cli/src/core/errors/envelope.spec.ts`:

```ts
import { ApiError, ExitCode, parseErrorEnvelope } from './index';

const envelope = (code: string, statusCode: number, details: unknown = null) => ({
  error: {
    code,
    message: `${code} happened`,
    statusCode,
    details,
    correlationId: 'cid-1',
    timestamp: '2026-09-06T00:00:00.000Z',
    path: '/contacts',
  },
});

describe('parseErrorEnvelope', () => {
  it('reads code, message and correlationId from the envelope', () => {
    const err = parseErrorEnvelope(404, envelope('NOT_FOUND', 404));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('NOT_FOUND happened');
    expect(err.correlationId).toBe('cid-1');
  });

  it('extracts zod issues from VALIDATION_FAILED details', () => {
    const err = parseErrorEnvelope(
      400,
      envelope('VALIDATION_FAILED', 400, {
        issues: [
          { path: ['slug'], message: 'must be lowercase-with-dashes' },
          { path: ['tagIds', 0], message: 'Invalid uuid' },
        ],
      }),
    );
    expect(err.issues).toEqual([
      { path: ['slug'], message: 'must be lowercase-with-dashes' },
      { path: ['tagIds', 0], message: 'Invalid uuid' },
    ]);
  });

  it('yields an empty issue list when details carry none', () => {
    expect(parseErrorEnvelope(404, envelope('NOT_FOUND', 404)).issues).toEqual([]);
  });

  it('falls back to UNKNOWN when a proxy returns HTML instead of an envelope', () => {
    const err = parseErrorEnvelope(502, '<html>Bad Gateway</html>');
    expect(err.code).toBe('UNKNOWN');
    expect(err.status).toBe(502);
    expect(err.exitCode).toBe(ExitCode.Failure);
  });

  it('falls back to UNKNOWN on a null body', () => {
    expect(parseErrorEnvelope(500, null).code).toBe('UNKNOWN');
  });

  describe('exit codes', () => {
    const cases: Array<[string, number, ExitCode]> = [
      ['VALIDATION_FAILED', 400, ExitCode.Usage],
      ['UNAUTHORIZED', 401, ExitCode.AuthRequired],
      ['AUTH_TOKEN_EXPIRED', 401, ExitCode.AuthRequired],
      ['AUTH_INVALID_CREDENTIALS', 401, ExitCode.AuthRequired],
      ['FORBIDDEN', 403, ExitCode.Forbidden],
      ['NOT_FOUND', 404, ExitCode.NotFound],
      ['USER_NOT_FOUND', 404, ExitCode.NotFound],
      ['CONFLICT', 409, ExitCode.Conflict],
      ['INTERNAL', 500, ExitCode.Failure],
    ];

    it.each(cases)('maps %s to the right exit code', (code, status, expected) => {
      expect(parseErrorEnvelope(status, envelope(code, status)).exitCode).toBe(
        expected,
      );
    });

    it('maps an unrecognised code by its HTTP status', () => {
      expect(
        parseErrorEnvelope(404, envelope('SOMETHING_NEW_NOT_FOUND', 404)).exitCode,
      ).toBe(ExitCode.NotFound);
    });
  });

  describe('auth classification', () => {
    it('treats only AUTH_TOKEN_EXPIRED as refreshable', () => {
      expect(
        parseErrorEnvelope(401, envelope('AUTH_TOKEN_EXPIRED', 401)).isAuthExpiry(),
      ).toBe(true);
      expect(
        parseErrorEnvelope(401, envelope('AUTH_TOKEN_INVALID', 401)).isAuthExpiry(),
      ).toBe(false);
    });

    it('treats INVALID and REUSE as a dead session', () => {
      expect(
        parseErrorEnvelope(401, envelope('AUTH_TOKEN_INVALID', 401)).isSessionGone(),
      ).toBe(true);
      expect(
        parseErrorEnvelope(401, envelope('AUTH_TOKEN_REUSE', 401)).isSessionGone(),
      ).toBe(true);
      expect(
        parseErrorEnvelope(401, envelope('AUTH_TOKEN_EXPIRED', 401)).isSessionGone(),
      ).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cli && pnpm jest src/core/errors`
Expected: FAIL — `Cannot find module './index'`.

- [ ] **Step 3: Implement ApiError**

`cli/src/core/errors/api-error.ts`:

```ts
export enum ExitCode {
  Ok = 0,
  Failure = 1,
  Usage = 2,
  AuthRequired = 3,
  NotFound = 4,
  Forbidden = 5,
  Conflict = 6,
}

/** One entry of the `details.issues` array the API sends for VALIDATION_FAILED. */
export interface ApiIssue {
  path: (string | number)[];
  message: string;
  code?: string;
}

const EXPIRED = 'AUTH_TOKEN_EXPIRED';
const SESSION_GONE = new Set(['AUTH_TOKEN_INVALID', 'AUTH_TOKEN_REUSE']);

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: ApiIssue[] = [],
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /**
   * Only an expiry is worth refreshing. INVALID and REUSE mean the session is
   * already gone server-side, and refreshing would spend the rotation budget
   * to be told so again.
   */
  isAuthExpiry(): boolean {
    return this.code === EXPIRED;
  }

  isSessionGone(): boolean {
    return SESSION_GONE.has(this.code);
  }

  get exitCode(): ExitCode {
    return exitCodeFor(this.code, this.status);
  }
}

export function exitCodeFor(code: string, status: number): ExitCode {
  if (code === 'VALIDATION_FAILED') return ExitCode.Usage;
  if (code.startsWith('AUTH_') || code === 'UNAUTHORIZED') {
    return ExitCode.AuthRequired;
  }
  // Fall through to the HTTP status, so a domain code added to the API after
  // this CLI was built still exits with something meaningful.
  switch (status) {
    case 400:
      return ExitCode.Usage;
    case 401:
      return ExitCode.AuthRequired;
    case 403:
      return ExitCode.Forbidden;
    case 404:
      return ExitCode.NotFound;
    case 409:
      return ExitCode.Conflict;
    default:
      return ExitCode.Failure;
  }
}
```

- [ ] **Step 4: Implement the envelope parser**

`cli/src/core/errors/envelope.ts`:

```ts
import { ApiError, type ApiIssue } from './api-error';

interface EnvelopeShape {
  error: {
    code: string;
    message: string;
    statusCode: number;
    details: unknown;
    correlationId: string;
    timestamp: string;
    path: string;
  };
}

function isEnvelope(body: unknown): body is EnvelopeShape {
  if (typeof body !== 'object' || body === null) return false;
  const err = (body as { error?: unknown }).error;
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { code?: unknown }).code === 'string'
  );
}

function issuesFrom(details: unknown): ApiIssue[] {
  if (typeof details !== 'object' || details === null) return [];
  const issues = (details as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];
  return issues.filter(
    (i): i is ApiIssue =>
      typeof i === 'object' &&
      i !== null &&
      Array.isArray((i as ApiIssue).path) &&
      typeof (i as ApiIssue).message === 'string',
  );
}

/**
 * Turns any error response into an ApiError.
 *
 * A gateway or proxy can answer with HTML rather than the API's envelope, so
 * the UNKNOWN fallback is a normal path, not a defensive flourish.
 */
export function parseErrorEnvelope(status: number, body: unknown): ApiError {
  if (!isEnvelope(body)) {
    return new ApiError(status, 'UNKNOWN', `Request failed with status ${status}`);
  }
  const { code, message, details, correlationId } = body.error;
  return new ApiError(status, code, message, issuesFrom(details), correlationId);
}
```

`cli/src/core/errors/index.ts`:

```ts
export { ApiError, ExitCode, exitCodeFor, type ApiIssue } from './api-error';
export { parseErrorEnvelope } from './envelope';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd cli && pnpm jest src/core/errors`
Expected: PASS, 17 tests.

- [ ] **Step 6: Commit**

```bash
git add cli/src/core/errors/
git commit -m "feat(cli): map the API error envelope to typed errors and exit codes"
```

---

### Task 5: SessionService

Depends on Tasks 2, 3 and 4.

**Files:**
- Create: `cli/src/core/session/session.service.ts`
- Create: `cli/src/core/session/refresh-race.child.ts` (test helper, not a spec)
- Test: `cli/src/core/session/session.service.spec.ts`, `cli/src/core/session/refresh-race.spec.ts`

**Interfaces:**
- Consumes: `TokenStore`, `TokenPair`, `isExpired`, `pairFromLogin`, `LoginResponse` (Task 2); `RefreshLock` (Task 3); `ApiError`, `parseErrorEnvelope` (Task 4).
- Produces:
  - `interface SessionDeps { store: TokenStore; lock: RefreshLock; fetchImpl?: typeof fetch; now?: () => number }`
  - `class SessionService`
    - `getAccessToken(profile: string, baseUrl: string): Promise<string>`
    - `refresh(profile: string, baseUrl: string, rejectedToken?: string): Promise<string>`
    - `login(profile: string, baseUrl: string, email: string, password: string): Promise<void>`
    - `logout(profile: string, baseUrl: string): Promise<void>`
    - `clear(profile: string): void`

- [ ] **Step 1: Write the failing unit test**

`cli/src/core/session/session.service.spec.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiError } from '../errors';
import { RefreshLock } from './refresh.lock';
import { SessionService } from './session.service';
import { TokenStore } from './token.store';

const BASE = 'http://api.test';
const NOW = 1_000_000;

function envelope(code: string, statusCode: number) {
  return {
    error: {
      code,
      message: `${code} happened`,
      statusCode,
      details: null,
      correlationId: 'cid',
      timestamp: '2026-09-06T00:00:00.000Z',
      path: '/auth/refresh',
    },
  };
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('SessionService', () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;
  let store: TokenStore;
  let lock: RefreshLock;
  let fetchImpl: jest.Mock;

  const make = () =>
    new SessionService({ store, lock, fetchImpl: fetchImpl as unknown as typeof fetch, now: () => NOW });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cyb-sess-'));
    env = { XDG_CONFIG_HOME: dir };
    store = new TokenStore(env);
    lock = new RefreshLock(join(dir, 'cybernetics', 'refresh.lock'), { pollMs: 5 });
    fetchImpl = jest.fn();
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns a live token without touching the network', async () => {
    store.write('dev', { accessToken: 'live', refreshToken: 'r', expiresAt: NOW + 600_000 });
    await expect(make().getAccessToken('dev', BASE)).resolves.toBe('live');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports auth required when no credentials exist', async () => {
    await expect(make().getAccessToken('dev', BASE)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('refreshes an expired token and persists the rotated pair', async () => {
    store.write('dev', { accessToken: 'old', refreshToken: 'r1', expiresAt: NOW - 1 });
    fetchImpl.mockResolvedValue(
      jsonResponse(200, { accessToken: 'new', refreshToken: 'r2', expiresIn: 900 }),
    );

    await expect(make().getAccessToken('dev', BASE)).resolves.toBe('new');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://api.test/auth/refresh');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      refreshToken: 'r1',
    });
    expect(store.read('dev')).toEqual({
      accessToken: 'new',
      refreshToken: 'r2',
      expiresAt: NOW + 900_000,
    });
  });

  it('adopts a pair another process rotated instead of refreshing again', async () => {
    // The state a waiter finds after the holder released the lock: the stored
    // token differs from the one that was rejected, and is live.
    store.write('dev', { accessToken: 'rotated', refreshToken: 'r2', expiresAt: NOW + 600_000 });
    await expect(make().refresh('dev', BASE, 'stale')).resolves.toBe('rotated');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does refresh when the stored token is the one that was rejected', async () => {
    store.write('dev', { accessToken: 'same', refreshToken: 'r1', expiresAt: NOW + 600_000 });
    fetchImpl.mockResolvedValue(
      jsonResponse(200, { accessToken: 'new', refreshToken: 'r2', expiresIn: 900 }),
    );
    await expect(make().refresh('dev', BASE, 'same')).resolves.toBe('new');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('clears credentials when the refresh token is rejected', async () => {
    store.write('dev', { accessToken: 'old', refreshToken: 'r1', expiresAt: NOW - 1 });
    fetchImpl.mockResolvedValue(jsonResponse(401, envelope('AUTH_TOKEN_REUSE', 401)));

    await expect(make().getAccessToken('dev', BASE)).rejects.toBeInstanceOf(ApiError);
    expect(store.read('dev')).toBeNull();
  });

  it('releases the lock after a failed refresh', async () => {
    store.write('dev', { accessToken: 'old', refreshToken: 'r1', expiresAt: NOW - 1 });
    fetchImpl.mockResolvedValue(jsonResponse(401, envelope('AUTH_TOKEN_INVALID', 401)));

    await expect(make().getAccessToken('dev', BASE)).rejects.toBeInstanceOf(ApiError);
    // A leaked lock would make this hang until the 10s timeout.
    await lock.acquire();
    lock.release();
  });

  it('login stores the pair returned by the API', async () => {
    fetchImpl.mockResolvedValue(
      jsonResponse(200, { accessToken: 'a', refreshToken: 'r', expiresIn: 900 }),
    );
    await make().login('dev', BASE, 'a@b.co', 'pw');
    expect(store.read('dev')).toEqual({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: NOW + 900_000,
    });
  });

  it('login surfaces bad credentials without storing anything', async () => {
    fetchImpl.mockResolvedValue(
      jsonResponse(401, envelope('AUTH_INVALID_CREDENTIALS', 401)),
    );
    await expect(make().login('dev', BASE, 'a@b.co', 'wrong')).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
    });
    expect(store.read('dev')).toBeNull();
  });

  it('logout revokes server-side and clears locally', async () => {
    store.write('dev', { accessToken: 'a', refreshToken: 'r', expiresAt: NOW + 600_000 });
    fetchImpl.mockResolvedValue(new Response(null, { status: 204 }));
    await make().logout('dev', BASE);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(store.read('dev')).toBeNull();
  });

  it('logout clears locally even when the revoke call fails', async () => {
    // Being offline must not leave tokens on disk that the user believes are gone.
    store.write('dev', { accessToken: 'a', refreshToken: 'r', expiresAt: NOW + 600_000 });
    fetchImpl.mockRejectedValue(new Error('network down'));
    await make().logout('dev', BASE);
    expect(store.read('dev')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cli && pnpm jest src/core/session/session.service.spec.ts`
Expected: FAIL — `Cannot find module './session.service'`.

- [ ] **Step 3: Implement SessionService**

`cli/src/core/session/session.service.ts`:

```ts
import { ApiError, parseErrorEnvelope } from '../errors';
import { RefreshLock } from './refresh.lock';
import { TokenStore } from './token.store';
import { isExpired, pairFromLogin, type LoginResponse } from './tokens';

export interface SessionDeps {
  store: TokenStore;
  lock: RefreshLock;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function notLoggedIn(): ApiError {
  return new ApiError(401, 'UNAUTHORIZED', 'Not logged in. Run `cyb login`.');
}

/**
 * Owns the token lifecycle: what is on disk, when it is renewed, and who is
 * allowed to renew it.
 */
export class SessionService {
  private readonly store: TokenStore;
  private readonly lock: RefreshLock;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(deps: SessionDeps) {
    this.store = deps.store;
    this.lock = deps.lock;
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch;
    this.now = deps.now ?? Date.now;
  }

  async getAccessToken(profile: string, baseUrl: string): Promise<string> {
    const current = this.store.read(profile);
    if (!current) throw notLoggedIn();
    if (!isExpired(current, this.now())) return current.accessToken;
    return this.refresh(profile, baseUrl);
  }

  /**
   * Renews the access token under the cross-process lock.
   *
   * `rejectedToken` is the access token a request just had refused. It exists
   * so the adopt-check below can tell "someone else already rotated" from "the
   * server rejected a token the clock still considers live" — the second needs
   * a refresh, the first must not have one.
   */
  async refresh(
    profile: string,
    baseUrl: string,
    rejectedToken?: string,
  ): Promise<string> {
    return this.lock.withLock(async () => {
      // Re-read INSIDE the lock. Without this every waiter would replay the
      // refresh token it queued with, and the API treats a second use of a
      // spent token as theft — revoking the entire family.
      const current = this.store.read(profile);
      if (!current) throw notLoggedIn();

      if (current.accessToken !== rejectedToken && !isExpired(current, this.now())) {
        return current.accessToken;
      }

      const res = await this.fetchImpl(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });

      if (!res.ok) {
        // The refresh token is spent, revoked or stolen. Nothing local can
        // recover it, and keeping it invites a REUSE report on the next run.
        this.store.clear(profile);
        throw parseErrorEnvelope(res.status, await readBody(res));
      }

      const pair = pairFromLogin(
        (await readBody(res)) as LoginResponse,
        this.now(),
      );
      this.store.write(profile, pair);
      return pair.accessToken;
    });
  }

  async login(
    profile: string,
    baseUrl: string,
    email: string,
    password: string,
  ): Promise<void> {
    const res = await this.fetchImpl(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw parseErrorEnvelope(res.status, await readBody(res));
    this.store.write(
      profile,
      pairFromLogin((await readBody(res)) as LoginResponse, this.now()),
    );
  }

  async logout(profile: string, baseUrl: string): Promise<void> {
    const current = this.store.read(profile);
    if (current) {
      try {
        await this.fetchImpl(`${baseUrl}/auth/logout`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: current.refreshToken }),
        });
      } catch {
        // Best effort. Failing to reach the server must not leave tokens on
        // disk that the user has been told are gone.
      }
    }
    this.store.clear(profile);
  }

  clear(profile: string): void {
    this.store.clear(profile);
  }
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `cd cli && pnpm jest src/core/session/session.service.spec.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Write the multi-process race helper**

This file is a child-process entrypoint, not a spec. `jest.config.js` matches only `*.spec.ts`, so it will not be collected as a test.

`cli/src/core/session/refresh-race.child.ts`:

```ts
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
```

- [ ] **Step 6: Write the failing multi-process test**

`cli/src/core/session/refresh-race.spec.ts`:

```ts
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
```

- [ ] **Step 7: Run the race test to verify it fails**

Run: `cd cli && pnpm jest src/core/session/refresh-race.spec.ts`
Expected: FAIL — the child cannot resolve `./session.service` until Step 3 is in place. If Step 3 already landed, this test should PASS; confirm it does before continuing.

- [ ] **Step 8: Run the race test to verify it passes**

Run: `cd cli && pnpm jest src/core/session/refresh-race.spec.ts`
Expected: PASS, 1 test. If `refreshCalls` is greater than 1, the lock is not holding — do not continue; this is the defect the whole task exists to prevent.

- [ ] **Step 9: Run the whole session suite**

Run: `cd cli && pnpm jest src/core/session`
Expected: PASS, 34 tests.

- [ ] **Step 10: Commit**

```bash
git add cli/src/core/session/
git commit -m "feat(cli): add SessionService with single-flight cross-process refresh"
```

---

### Task 6: ApiClient

Depends on Tasks 4 and 5.

**Files:**
- Create: `cli/src/core/http/api.client.ts`
- Test: `cli/src/core/http/api.client.spec.ts`

**Interfaces:**
- Consumes: `SessionService` (Task 5); `ApiError`, `parseErrorEnvelope` (Task 4).
- Produces:
  - `interface ApiClientOptions { baseUrl: string; profile: string; session: SessionService; fetchImpl?: typeof fetch; maxRetries?: number; sleepImpl?: (ms: number) => Promise<void> }`
  - `class ApiClient`
    - `request<T>(path: string, init?: RequestInit): Promise<T>`
    - `get<T>(path: string, init?: RequestInit): Promise<T>`
    - `post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>`
    - `patch<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>`
    - `del<T>(path: string, init?: RequestInit): Promise<T>`

- [ ] **Step 1: Write the failing test**

`cli/src/core/http/api.client.spec.ts`:

```ts
import { ApiError } from '../errors';
import type { SessionService } from '../session/session.service';
import { ApiClient } from './api.client';

const BASE = 'http://api.test';

function envelope(code: string, statusCode: number) {
  return {
    error: {
      code,
      message: `${code} happened`,
      statusCode,
      details: null,
      correlationId: 'cid',
      timestamp: '2026-09-06T00:00:00.000Z',
      path: '/contacts',
    },
  };
}

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('ApiClient', () => {
  let fetchImpl: jest.Mock;
  let session: { getAccessToken: jest.Mock; refresh: jest.Mock; clear: jest.Mock };
  let sleeps: number[];

  const make = () =>
    new ApiClient({
      baseUrl: BASE,
      profile: 'dev',
      session: session as unknown as SessionService,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
    });

  beforeEach(() => {
    fetchImpl = jest.fn();
    sleeps = [];
    session = {
      getAccessToken: jest.fn().mockResolvedValue('tok-1'),
      refresh: jest.fn().mockResolvedValue('tok-2'),
      clear: jest.fn(),
    };
  });

  it('sends the bearer token and returns the parsed body', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(200, { id: 'c1' }));
    await expect(make().get('/contacts/c1')).resolves.toEqual({ id: 'c1' });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://api.test/contacts/c1');
    expect(new Headers((init as RequestInit).headers).get('authorization')).toBe(
      'Bearer tok-1',
    );
  });

  it('returns null for a 204', async () => {
    fetchImpl.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(make().del('/contacts/c1')).resolves.toBeNull();
  });

  it('serialises a JSON body on post', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(200, { ok: true }));
    await make().post('/contacts', { firstName: 'Dana' });
    const [, init] = fetchImpl.mock.calls[0];
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      firstName: 'Dana',
    });
  });

  it('refreshes once and retries once on AUTH_TOKEN_EXPIRED', async () => {
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(401, envelope('AUTH_TOKEN_EXPIRED', 401)))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'c1' }));

    await expect(make().get('/contacts/c1')).resolves.toEqual({ id: 'c1' });

    expect(session.refresh).toHaveBeenCalledTimes(1);
    expect(session.refresh).toHaveBeenCalledWith('dev', BASE, 'tok-1');
    expect(
      new Headers((fetchImpl.mock.calls[1][1] as RequestInit).headers).get(
        'authorization',
      ),
    ).toBe('Bearer tok-2');
  });

  it('does not retry more than once on a repeated 401', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(401, envelope('AUTH_TOKEN_EXPIRED', 401)));
    await expect(make().get('/contacts')).rejects.toBeInstanceOf(ApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(session.refresh).toHaveBeenCalledTimes(1);
  });

  it('clears the session and does not refresh on AUTH_TOKEN_REUSE', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(401, envelope('AUTH_TOKEN_REUSE', 401)));
    await expect(make().get('/contacts')).rejects.toMatchObject({
      code: 'AUTH_TOKEN_REUSE',
    });
    expect(session.refresh).not.toHaveBeenCalled();
    expect(session.clear).toHaveBeenCalledWith('dev');
  });

  it('clears the session and does not refresh on AUTH_TOKEN_INVALID', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(401, envelope('AUTH_TOKEN_INVALID', 401)));
    await expect(make().get('/contacts')).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
    expect(session.refresh).not.toHaveBeenCalled();
    expect(session.clear).toHaveBeenCalledWith('dev');
  });

  it('honours Retry-After on a 429 and then succeeds', async () => {
    fetchImpl
      .mockResolvedValueOnce(
        jsonResponse(429, envelope('RATE_LIMITED', 429), { 'retry-after': '2' }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { id: 'c1' }));

    await expect(make().get('/contacts/c1')).resolves.toEqual({ id: 'c1' });
    expect(sleeps).toEqual([2000]);
  });

  it('gives up after maxRetries 429s', async () => {
    fetchImpl.mockResolvedValue(
      jsonResponse(429, envelope('RATE_LIMITED', 429), { 'retry-after': '1' }),
    );
    await expect(make().get('/contacts')).rejects.toMatchObject({ status: 429 });
    // initial attempt + 3 retries
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('defaults the 429 wait when Retry-After is absent', async () => {
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(429, envelope('RATE_LIMITED', 429)))
      .mockResolvedValueOnce(jsonResponse(200, {}));
    await make().get('/contacts');
    expect(sleeps).toEqual([1000]);
  });

  it('wraps a non-JSON error body as UNKNOWN', async () => {
    fetchImpl.mockResolvedValue(
      new Response('<html>502</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    );
    await expect(make().get('/contacts')).rejects.toMatchObject({
      code: 'UNKNOWN',
      status: 502,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cli && pnpm jest src/core/http`
Expected: FAIL — `Cannot find module './api.client'`.

- [ ] **Step 3: Implement ApiClient**

`cli/src/core/http/api.client.ts`:

```ts
import { ApiError, parseErrorEnvelope } from '../errors';
import type { SessionService } from '../session/session.service';

export interface ApiClientOptions {
  baseUrl: string;
  profile: string;
  session: SessionService;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_AFTER_MS = 1_000;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204 || res.headers.get('content-length') === '0') return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // A proxy or gateway can answer with HTML; hand it back so the envelope
    // parser can fall through to UNKNOWN.
    return text;
  }
}

function retryAfterMs(res: Response): number {
  const header = res.headers.get('retry-after');
  const seconds = header === null ? NaN : Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS;
}

/**
 * The only module that knows about the base URL, bearer tokens or retries.
 *
 * The 401 branch mirrors `client/lib/api/client.ts`: exactly one refresh and
 * exactly one retry. A second 401 means the fresh token is being rejected too,
 * and retrying again would loop.
 */
export class ApiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: ApiClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.sleep = opts.sleepImpl ?? defaultSleep;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const { baseUrl, profile, session } = this.opts;
    let token = await session.getAccessToken(profile, baseUrl);
    let attempts = 0;
    let refreshed = false;

    for (;;) {
      const res = await this.send(path, init, token);

      if (res.status === 401) {
        const err = parseErrorEnvelope(401, await readBody(res));
        if (err.isSessionGone()) {
          session.clear(profile);
          throw err;
        }
        if (!err.isAuthExpiry() || refreshed) throw err;
        refreshed = true;
        token = await session.refresh(profile, baseUrl, token);
        continue;
      }

      if (res.status === 429 && attempts < this.maxRetries) {
        attempts += 1;
        await this.sleep(retryAfterMs(res));
        continue;
      }

      if (!res.ok) throw parseErrorEnvelope(res.status, await readBody(res));
      return (await readBody(res)) as T;
    }
  }

  get<T>(path: string, init: RequestInit = {}): Promise<T> {
    return this.request<T>(path, { ...init, method: 'GET' });
  }

  post<T>(path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
    return this.withBody<T>('POST', path, body, init);
  }

  patch<T>(path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
    return this.withBody<T>('PATCH', path, body, init);
  }

  del<T>(path: string, init: RequestInit = {}): Promise<T> {
    return this.request<T>(path, { ...init, method: 'DELETE' });
  }

  private withBody<T>(
    method: string,
    path: string,
    body: unknown,
    init: RequestInit,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    return this.request<T>(path, {
      ...init,
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private send(path: string, init: RequestInit, token: string): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    return this.fetchImpl(`${this.opts.baseUrl}${path}`, { ...init, headers });
  }
}

export { ApiError };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd cli && pnpm jest src/core/http`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add cli/src/core/http/
git commit -m "feat(cli): add ApiClient with single-retry refresh and 429 backoff"
```

---

### Task 7: OpenAPI codegen and drift check

Independent of Tasks 2–6; may run in parallel with any of them once Task 1 lands.

**Files:**
- Create: `cli/src/codegen/openapi.types.ts`
- Create: `cli/src/codegen/build.ts`
- Create: `cli/src/codegen/generate.ts`
- Create: `cli/src/generated/.gitkeep`
- Modify: `cli/package.json` — add the `codegen:check` script
- Test: `cli/src/codegen/build.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface OperationMeta { operationId: string; method: string; path: string; pathParams: string[]; queryParams: string[]; requestSchema?: string; isPublic: boolean }`
  - `buildOperations(doc: OpenApiDoc): OperationMeta[]`
  - `renderOperations(ops: OperationMeta[]): string`
  - `renderSchemas(doc: OpenApiDoc): string`
  - Generated `cli/src/generated/operations.ts` exporting `const operations: Record<string, OperationMeta>`
  - Generated `cli/src/generated/schemas.ts` exporting `const schemas: Record<string, unknown>`

- [ ] **Step 1: Write the failing test**

`cli/src/codegen/build.spec.ts`:

```ts
import { buildOperations, renderOperations, renderSchemas } from './build';
import type { OpenApiDoc } from './openapi.types';

const DOC: OpenApiDoc = {
  openapi: '3.0.0',
  info: { title: 'Cybernetics', version: '1.0' },
  paths: {
    '/contacts': {
      get: {
        operationId: 'ContactController_list',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'number' } },
        ],
      },
      post: {
        operationId: 'ContactController_create',
        requestBody: {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateContactDto' },
            },
          },
        },
      },
    },
    '/contacts/{id}': {
      patch: {
        operationId: 'ContactController_update',
        parameters: [{ name: 'id', in: 'path', schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateContactDto' },
            },
          },
        },
      },
    },
    '/auth/login': {
      post: { operationId: 'AuthController_login', security: [] },
    },
  },
  components: {
    schemas: {
      CreateContactDto: { type: 'object', properties: { firstName: { type: 'string' } } },
      UpdateContactDto: { type: 'object', properties: { firstName: { type: 'string' } } },
    },
  },
};

describe('buildOperations', () => {
  const ops = buildOperations(DOC);
  const byId = (id: string) => ops.find((o) => o.operationId === id)!;

  it('finds every operation', () => {
    expect(ops.map((o) => o.operationId).sort()).toEqual([
      'AuthController_login',
      'ContactController_create',
      'ContactController_list',
      'ContactController_update',
    ]);
  });

  it('records method and path', () => {
    expect(byId('ContactController_list')).toMatchObject({
      method: 'get',
      path: '/contacts',
    });
  });

  it('separates path params from query params', () => {
    expect(byId('ContactController_list').queryParams).toEqual(['status', 'page']);
    expect(byId('ContactController_list').pathParams).toEqual([]);
    expect(byId('ContactController_update').pathParams).toEqual(['id']);
  });

  it('resolves the request body schema to a component name', () => {
    expect(byId('ContactController_create').requestSchema).toBe('CreateContactDto');
    expect(byId('ContactController_list').requestSchema).toBeUndefined();
  });

  it('marks operations with an empty security array as public', () => {
    expect(byId('AuthController_login').isPublic).toBe(true);
    expect(byId('ContactController_list').isPublic).toBe(false);
  });
});

describe('renderOperations', () => {
  it('emits a compiling module keyed by operationId', () => {
    const out = renderOperations(buildOperations(DOC));
    expect(out).toContain('// GENERATED BY `pnpm codegen` — DO NOT EDIT');
    expect(out).toContain("'ContactController_list':");
    expect(out).toContain('"path":"/contacts"');
    expect(out).toContain('export const operations');
  });

  it('sorts keys so regeneration is diff-stable', () => {
    const out = renderOperations(buildOperations(DOC));
    const order = [...out.matchAll(/^ {2}'([A-Za-z_]+)':/gm)].map((m) => m[1]);
    expect(order).toEqual([...order].sort());
  });
});

describe('renderSchemas', () => {
  it('emits the component schemas verbatim', () => {
    const out = renderSchemas(DOC);
    expect(out).toContain('export const schemas');
    expect(out).toContain('CreateContactDto');
    expect(out).toContain('firstName');
  });

  it('emits an empty object when the document has no components', () => {
    const out = renderSchemas({ ...DOC, components: undefined });
    expect(out).toContain('schemas: Record<string, unknown> = {};');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cli && pnpm jest src/codegen`
Expected: FAIL — `Cannot find module './build'`.

- [ ] **Step 3: Implement the document types**

`cli/src/codegen/openapi.types.ts`:

```ts
export interface OpenApiParameter {
  name: string;
  in: 'query' | 'path' | 'header' | 'cookie';
  schema?: unknown;
}

export interface OpenApiOperation {
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    content?: Record<string, { schema?: { $ref?: string } }>;
  };
  security?: unknown[];
}

export type OpenApiPathItem = Record<string, OpenApiOperation | undefined>;

export interface OpenApiDoc {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, OpenApiPathItem>;
  components?: { schemas?: Record<string, unknown> };
}

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
```

- [ ] **Step 4: Implement the builder and renderers**

`cli/src/codegen/build.ts`:

```ts
import {
  HTTP_METHODS,
  type OpenApiDoc,
  type OpenApiOperation,
} from './openapi.types';

export interface OperationMeta {
  operationId: string;
  method: string;
  path: string;
  pathParams: string[];
  queryParams: string[];
  /** Component name of the JSON request body schema, if the operation takes one. */
  requestSchema?: string;
  isPublic: boolean;
}

const BANNER = '// GENERATED BY `pnpm codegen` — DO NOT EDIT\n';

function requestSchemaOf(op: OpenApiOperation): string | undefined {
  const ref = op.requestBody?.content?.['application/json']?.schema?.$ref;
  if (!ref) return undefined;
  return ref.split('/').pop();
}

export function buildOperations(doc: OpenApiDoc): OperationMeta[] {
  const out: OperationMeta[] = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = item?.[method];
      if (!op?.operationId) continue;
      const params = op.parameters ?? [];
      out.push({
        operationId: op.operationId,
        method,
        path,
        pathParams: params.filter((p) => p.in === 'path').map((p) => p.name),
        queryParams: params.filter((p) => p.in === 'query').map((p) => p.name),
        requestSchema: requestSchemaOf(op),
        // `stripSecurityForPublic` in the API sets `security: []` on @Public()
        // routes; that empty array is the only public marker in the document.
        isPublic: Array.isArray(op.security) && op.security.length === 0,
      });
    }
  }
  return out;
}

export function renderOperations(ops: OperationMeta[]): string {
  // Sorted so `pnpm codegen` produces a stable diff and the CI drift check
  // reports real changes rather than key reordering.
  const sorted = [...ops].sort((a, b) =>
    a.operationId.localeCompare(b.operationId),
  );
  const body = sorted
    .map((op) => `  '${op.operationId}': ${JSON.stringify(op)},`)
    .join('\n');

  return `${BANNER}
export interface OperationMeta {
  operationId: string;
  method: string;
  path: string;
  pathParams: string[];
  queryParams: string[];
  requestSchema?: string;
  isPublic: boolean;
}

export const operations: Record<string, OperationMeta> = {
${body}
};
`;
}

export function renderSchemas(doc: OpenApiDoc): string {
  const schemas = doc.components?.schemas;
  const rendered =
    schemas && Object.keys(schemas).length > 0
      ? JSON.stringify(sortKeys(schemas), null, 2)
      : '{}';
  return `${BANNER}
export const schemas: Record<string, unknown> = ${rendered};
`;
}

function sortKeys<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.keys(obj)
      .sort()
      .map((k) => [k, obj[k]]),
  ) as T;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd cli && pnpm jest src/codegen`
Expected: PASS, 9 tests.

- [ ] **Step 6: Implement the generator entrypoint**

`cli/src/codegen/generate.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOperations, renderOperations, renderSchemas } from './build';
import type { OpenApiDoc } from './openapi.types';

const OUT_DIR = join(__dirname, '..', 'generated');
const DEFAULT_SOURCE = 'http://localhost:3000/openapi.json';

async function main(): Promise<void> {
  const source = process.env.CYB_OPENAPI_URL ?? DEFAULT_SOURCE;
  const res = await fetch(source);
  if (!res.ok) {
    throw new Error(
      `GET ${source} returned ${res.status}. ` +
        `Start the API with OPENAPI_ENABLED=true, or set CYB_OPENAPI_URL.`,
    );
  }
  const doc = (await res.json()) as OpenApiDoc;

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    join(OUT_DIR, 'openapi.json'),
    `${JSON.stringify(doc, null, 2)}\n`,
  );
  writeFileSync(
    join(OUT_DIR, 'operations.ts'),
    renderOperations(buildOperations(doc)),
  );
  writeFileSync(join(OUT_DIR, 'schemas.ts'), renderSchemas(doc));

  process.stdout.write(`Generated from ${source}\n`);
}

main().catch((err: Error) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
```

- [ ] **Step 7: Add the drift-check script**

In `cli/package.json`, add to `scripts`:

```json
"codegen:check": "pnpm codegen && git diff --exit-code src/generated/"
```

- [ ] **Step 8: Generate against the running API**

Start the API in another shell (`cd api && pnpm start:dev`, with `OPENAPI_ENABLED=true`), then:

Run: `cd cli && pnpm codegen`
Expected: `Generated from http://localhost:3000/openapi.json`, and three files appear in `cli/src/generated/`.

If the API's port differs from 3000, set `CYB_OPENAPI_URL` accordingly.

- [ ] **Step 9: Verify the generated output compiles**

Run: `cd cli && pnpm typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add cli/src/codegen/ cli/src/generated/ cli/package.json
git commit -m "feat(cli): generate API contracts from the OpenAPI document"
```

---

### Task 8: DI wiring, settings resolution and the entrypoint

Depends on Tasks 1, 4, 5 and 6.

**Files:**
- Create: `cli/src/core/config/settings.service.ts`
- Create: `cli/src/core/errors/report.ts`
- Create: `cli/src/core/http/client.factory.ts`
- Create: `cli/src/commands/config/profile.command.ts`
- Create: `cli/src/app.module.ts`
- Create: `cli/src/main.ts`
- Test: `cli/src/core/config/settings.service.spec.ts`, `cli/src/core/errors/report.spec.ts`

**Interfaces:**
- Consumes: `ConfigStore`, `CliConfig`, `Profile` (Task 1); `ApiError`, `ExitCode` (Task 4); `SessionService` (Task 5); `ApiClient` (Task 6); `credentialsPath`, `lockPath` (Task 1).
- Produces:
  - `interface ResolvedSettings { profile: string; baseUrl: string; email?: string }`
  - `interface SettingsOverrides { profile?: string; api?: string }`
  - `class SettingsService { constructor(config: ConfigStore, env?: NodeJS.ProcessEnv); resolve(o?: SettingsOverrides): ResolvedSettings }`
  - `reportError(err: unknown, write: (s: string) => void): ExitCode`
  - `class ClientFactory { create(s: ResolvedSettings): ApiClient }`

- [ ] **Step 1: Write the failing test for settings precedence**

`cli/src/core/config/settings.service.spec.ts`:

```ts
import { ConfigStore, type CliConfig } from './config.store';
import { SettingsService } from './settings.service';

const CONFIG: CliConfig = {
  currentProfile: 'dev',
  profiles: {
    dev: { baseUrl: 'http://localhost:3000', email: 'dev@x.co' },
    prod: { baseUrl: 'https://api.example.com', email: 'me@x.co' },
  },
};

function make(env: NodeJS.ProcessEnv) {
  const config = { read: () => CONFIG } as unknown as ConfigStore;
  return new SettingsService(config, env);
}

describe('SettingsService', () => {
  it('uses the config file when nothing overrides it', () => {
    expect(make({}).resolve()).toEqual({
      profile: 'dev',
      baseUrl: 'http://localhost:3000',
      email: 'dev@x.co',
    });
  });

  it('lets CYB_PROFILE override the current profile', () => {
    expect(make({ CYB_PROFILE: 'prod' }).resolve().baseUrl).toBe(
      'https://api.example.com',
    );
  });

  it('lets a flag override CYB_PROFILE', () => {
    expect(
      make({ CYB_PROFILE: 'prod' }).resolve({ profile: 'dev' }).baseUrl,
    ).toBe('http://localhost:3000');
  });

  it('lets CYB_API_URL override the profile base URL', () => {
    expect(make({ CYB_API_URL: 'http://other:9000' }).resolve().baseUrl).toBe(
      'http://other:9000',
    );
  });

  it('lets the --api flag override CYB_API_URL', () => {
    expect(
      make({ CYB_API_URL: 'http://other:9000' }).resolve({ api: 'http://flag:1' })
        .baseUrl,
    ).toBe('http://flag:1');
  });

  it('strips a trailing slash so paths do not double up', () => {
    expect(make({}).resolve({ api: 'http://x:3000/' }).baseUrl).toBe('http://x:3000');
  });

  it('explains how to fix an unknown profile', () => {
    expect(() => make({}).resolve({ profile: 'nope' })).toThrow(
      /Unknown profile "nope".*cyb config profile add/s,
    );
  });

  it('explains how to fix a profile with no base URL', () => {
    const config = {
      read: () => ({ currentProfile: 'empty', profiles: { empty: {} } }),
    } as unknown as ConfigStore;
    expect(() => new SettingsService(config, {}).resolve()).toThrow(
      /No API URL for profile "empty"/,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cli && pnpm jest src/core/config/settings.service.spec.ts`
Expected: FAIL — `Cannot find module './settings.service'`.

- [ ] **Step 3: Implement SettingsService**

`cli/src/core/config/settings.service.ts`:

```ts
import { Injectable, Optional } from '@nestjs/common';
import { ConfigStore } from './config.store';

export interface ResolvedSettings {
  profile: string;
  baseUrl: string;
  email?: string;
}

export interface SettingsOverrides {
  profile?: string;
  api?: string;
}

/**
 * Resolves the effective profile and base URL.
 *
 * Precedence is flags → environment → config file, so a one-off `--api` never
 * requires editing the file, and CI can point the same binary at a different
 * deployment through the environment alone.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly config: ConfigStore,
    // See ConfigStore: an interface-typed param must be @Optional() or Nest
    // fails to resolve it at boot.
    @Optional() private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  resolve(overrides: SettingsOverrides = {}): ResolvedSettings {
    const cfg = this.config.read();
    const profile =
      overrides.profile ?? this.env.CYB_PROFILE ?? cfg.currentProfile;

    const entry = cfg.profiles[profile];
    const explicitUrl = overrides.api ?? this.env.CYB_API_URL;

    if (!entry && !explicitUrl) {
      throw new Error(
        `Unknown profile "${profile}". ` +
          `Add it with: cyb config profile add ${profile} --api <url>`,
      );
    }

    const baseUrl = explicitUrl ?? entry?.baseUrl;
    if (!baseUrl) {
      throw new Error(
        `No API URL for profile "${profile}". ` +
          `Set one with: cyb config profile add ${profile} --api <url>`,
      );
    }

    return {
      profile,
      baseUrl: baseUrl.replace(/\/+$/, ''),
      email: entry?.email,
    };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd cli && pnpm jest src/core/config/settings.service.spec.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write the failing test for error reporting**

`cli/src/core/errors/report.spec.ts`:

```ts
import { ApiError, ExitCode } from './index';
import { reportError } from './report';

describe('reportError', () => {
  let lines: string[];
  const write = (s: string) => {
    lines.push(s);
  };

  beforeEach(() => {
    lines = [];
  });

  it('prints the message and returns the mapped exit code', () => {
    const code = reportError(new ApiError(404, 'NOT_FOUND', 'No such contact'), write);
    expect(code).toBe(ExitCode.NotFound);
    expect(lines.join('')).toContain('No such contact');
  });

  it('lists validation issues with their field paths', () => {
    const err = new ApiError(400, 'VALIDATION_FAILED', 'Validation failed', [
      { path: ['slug'], message: 'must be lowercase-with-dashes' },
      { path: ['tagIds', 0], message: 'Invalid uuid' },
    ]);
    reportError(err, write);
    const out = lines.join('');
    expect(out).toContain('slug: must be lowercase-with-dashes');
    expect(out).toContain('tagIds.0: Invalid uuid');
  });

  it('includes the correlation id so a server log can be found', () => {
    reportError(new ApiError(500, 'INTERNAL', 'Boom', [], 'cid-42'), write);
    expect(lines.join('')).toContain('cid-42');
  });

  it('adds a login hint when authentication is required', () => {
    reportError(new ApiError(401, 'AUTH_TOKEN_INVALID', 'Token invalid'), write);
    expect(lines.join('')).toContain('cyb login');
  });

  it('reports a plain Error as a generic failure', () => {
    expect(reportError(new Error('something broke'), write)).toBe(ExitCode.Failure);
    expect(lines.join('')).toContain('something broke');
  });

  it('reports a non-Error throw without crashing', () => {
    expect(reportError('a string', write)).toBe(ExitCode.Failure);
    expect(lines.join('')).toContain('a string');
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd cli && pnpm jest src/core/errors/report.spec.ts`
Expected: FAIL — `Cannot find module './report'`.

- [ ] **Step 7: Implement the error reporter**

`cli/src/core/errors/report.ts`:

```ts
import pc from 'picocolors';
import { ApiError, ExitCode } from './api-error';

/**
 * Renders any thrown value to stderr and returns the process exit code.
 *
 * `write` is injected so the behaviour is assertable without capturing the
 * real stderr.
 */
export function reportError(
  err: unknown,
  write: (s: string) => void,
): ExitCode {
  if (err instanceof ApiError) {
    write(`${pc.red('error')} ${err.message}\n`);

    for (const issue of err.issues) {
      write(`  ${pc.yellow(issue.path.join('.'))}: ${issue.message}\n`);
    }

    if (err.exitCode === ExitCode.AuthRequired) {
      write(`\nRun ${pc.bold('cyb login')} to authenticate.\n`);
    }

    if (err.correlationId) {
      write(pc.dim(`\ncorrelation id: ${err.correlationId}\n`));
    }

    return err.exitCode;
  }

  const message = err instanceof Error ? err.message : String(err);
  write(`${pc.red('error')} ${message}\n`);
  return ExitCode.Failure;
}
```

Add the export to `cli/src/core/errors/index.ts`:

```ts
export { ApiError, ExitCode, exitCodeFor, type ApiIssue } from './api-error';
export { parseErrorEnvelope } from './envelope';
export { reportError } from './report';
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd cli && pnpm jest src/core/errors`
Expected: PASS, 23 tests.

- [ ] **Step 9: Implement the client factory**

`cli/src/core/http/client.factory.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { lockPath } from '../config/paths';
import type { ResolvedSettings } from '../config/settings.service';
import { RefreshLock } from '../session/refresh.lock';
import { SessionService } from '../session/session.service';
import { TokenStore } from '../session/token.store';
import { ApiClient } from './api.client';

/**
 * Builds a client for one resolved profile.
 *
 * A factory rather than a provider because the base URL and profile are known
 * only after the command's flags are parsed.
 */
@Injectable()
export class ClientFactory {
  constructor(private readonly session: SessionService) {}

  create(settings: ResolvedSettings): ApiClient {
    return new ApiClient({
      baseUrl: settings.baseUrl,
      profile: settings.profile,
      session: this.session,
    });
  }
}

/** Provider factory for SessionService — wires the store and lock to real paths. */
export function sessionServiceFactory(): SessionService {
  return new SessionService({
    store: new TokenStore(),
    lock: new RefreshLock(lockPath()),
  });
}
```

- [ ] **Step 10: Implement the config profile commands**

`cli/src/commands/config/profile.command.ts`:

```ts
import { Command, CommandRunner, Option, SubCommand } from 'nest-commander';
import { ConfigStore } from '../../core/config/config.store';

interface AddOptions {
  api: string;
  email?: string;
  use?: boolean;
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
      throw new Error(
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
```

- [ ] **Step 11: Implement the module and entrypoint**

`cli/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import {
  ConfigCommand,
  ProfileAddCommand,
  ProfileCommand,
  ProfileListCommand,
  ProfileUseCommand,
} from './commands/config/profile.command';
import { ConfigStore } from './core/config/config.store';
import { SettingsService } from './core/config/settings.service';
import { ClientFactory, sessionServiceFactory } from './core/http/client.factory';
import { SessionService } from './core/session/session.service';

@Module({
  providers: [
    ConfigStore,
    SettingsService,
    ClientFactory,
    { provide: SessionService, useFactory: sessionServiceFactory },
    ConfigCommand,
    ProfileCommand,
    ProfileAddCommand,
    ProfileUseCommand,
    ProfileListCommand,
  ],
})
export class AppModule {}
```

`cli/src/main.ts`:

```ts
import 'reflect-metadata';
import { CommandFactory } from 'nest-commander';
import { AppModule } from './app.module';
import { ExitCode, reportError } from './core/errors';

async function bootstrap(): Promise<void> {
  await CommandFactory.run(AppModule, {
    // Nest's banner and provider logs are noise in a CLI; errors still surface
    // through the handler below.
    logger: false,
    errorHandler: (err) => {
      process.exitCode = reportError(err, (s) => process.stderr.write(s));
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
```

- [ ] **Step 12: Build and verify the CLI runs**

Run: `cd cli && pnpm build && node dist/cyb.js config profile ls`
Expected: `No profiles. Add one with: cyb config profile add`

Run: `node dist/cyb.js config profile add dev --api http://localhost:3000 --email you@example.com`
Expected: `Profile "dev" saved.`

Run: `node dist/cyb.js config profile ls`
Expected: `* dev	http://localhost:3000`

- [ ] **Step 13: Run the whole suite**

Run: `cd cli && pnpm verify`
Expected: typecheck clean, all tests pass.

- [ ] **Step 14: Commit**

```bash
git add cli/
git commit -m "feat(cli): wire DI, settings precedence, error reporting and config commands"
```

---

### Task 9: Auth commands

Depends on Task 8.

**Files:**
- Create: `cli/src/commands/auth/login.command.ts`
- Create: `cli/src/commands/auth/logout.command.ts`
- Create: `cli/src/commands/auth/whoami.command.ts`
- Create: `cli/src/commands/auth/sessions.command.ts`
- Modify: `cli/src/app.module.ts` — register the four commands
- Test: `cli/src/commands/auth/login.command.spec.ts`

**Interfaces:**
- Consumes: `SettingsService`, `SessionService`, `ClientFactory`, `ApiClient`.
- Produces: no exported API beyond the command classes.

- [ ] **Step 1: Write the failing test**

`cli/src/commands/auth/login.command.spec.ts`:

```ts
import type { SettingsService } from '../../core/config/settings.service';
import type { SessionService } from '../../core/session/session.service';
import { LoginCommand } from './login.command';

describe('LoginCommand', () => {
  const settings = {
    resolve: () => ({
      profile: 'dev',
      baseUrl: 'http://api.test',
      email: 'default@x.co',
    }),
  } as unknown as SettingsService;

  let session: { login: jest.Mock };
  let out: string[];

  const make = (password = 'pw') =>
    new LoginCommand(
      settings,
      session as unknown as SessionService,
      async () => password,
      (s: string) => out.push(s),
    );

  beforeEach(() => {
    session = { login: jest.fn().mockResolvedValue(undefined) };
    out = [];
  });

  it('logs in with the --email flag when given', async () => {
    await make().run([], { email: 'flag@x.co' });
    expect(session.login).toHaveBeenCalledWith(
      'dev',
      'http://api.test',
      'flag@x.co',
      'pw',
    );
  });

  it('falls back to the profile email when no flag is given', async () => {
    await make().run([], {});
    expect(session.login).toHaveBeenCalledWith(
      'dev',
      'http://api.test',
      'default@x.co',
      'pw',
    );
  });

  it('confirms which profile was signed into', async () => {
    await make().run([], {});
    expect(out.join('')).toContain('dev');
  });

  it('does not retry a rejected password', async () => {
    // POST /auth/login allows 5 attempts per minute; an automatic retry would
    // spend that budget and lock the user out.
    session.login.mockRejectedValue(new Error('AUTH_INVALID_CREDENTIALS'));
    await expect(make().run([], {})).rejects.toThrow();
    expect(session.login).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cli && pnpm jest src/commands/auth`
Expected: FAIL — `Cannot find module './login.command'`.

- [ ] **Step 3: Implement the login command**

`cli/src/commands/auth/login.command.ts`:

```ts
import { Optional } from '@nestjs/common';
import { password as promptPassword } from '@inquirer/prompts';
import { Command, CommandRunner, Option } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { SessionService } from '../../core/session/session.service';

interface LoginOptions {
  profile?: string;
  api?: string;
  email?: string;
}

export type PasswordPrompt = () => Promise<string>;
export type Writer = (s: string) => void;

@Command({ name: 'login', description: 'Authenticate and store a session' })
export class LoginCommand extends CommandRunner {
  constructor(
    private readonly settings: SettingsService,
    private readonly session: SessionService,
    // Injected so the command is testable without a TTY. @Optional() is
    // required: a function-typed param is emitted as `Function`, which Nest
    // would otherwise try — and fail — to resolve as a provider.
    @Optional()
    private readonly prompt: PasswordPrompt = () =>
      promptPassword({ message: 'Password:', mask: true }),
    @Optional()
    private readonly write: Writer = (s) => process.stdout.write(s),
  ) {
    super();
  }

  @Option({ flags: '-p, --profile <name>', description: 'Profile to use' })
  parseProfile(v: string): string {
    return v;
  }

  @Option({ flags: '--api <url>', description: 'Override the API base URL' })
  parseApi(v: string): string {
    return v;
  }

  @Option({ flags: '-e, --email <email>', description: 'Login email' })
  parseEmail(v: string): string {
    return v;
  }

  async run(_params: string[], options: LoginOptions): Promise<void> {
    const resolved = this.settings.resolve(options);
    const email = options.email ?? resolved.email;
    if (!email) {
      throw new Error(
        'No email. Pass --email, or set one with: cyb config profile add',
      );
    }

    const password = await this.prompt();

    // Deliberately no retry loop: /auth/login allows 5 attempts per minute,
    // and burning that budget locks the user out for longer than re-running.
    await this.session.login(resolved.profile, resolved.baseUrl, email, password);

    this.write(`Signed in as ${email} on profile "${resolved.profile}".\n`);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd cli && pnpm jest src/commands/auth`
Expected: PASS, 4 tests.

- [ ] **Step 5: Implement logout, whoami and sessions**

`cli/src/commands/auth/logout.command.ts`:

```ts
import { Command, CommandRunner, Option } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { SessionService } from '../../core/session/session.service';

interface LogoutOptions {
  profile?: string;
  api?: string;
}

@Command({ name: 'logout', description: 'Revoke the stored session' })
export class LogoutCommand extends CommandRunner {
  constructor(
    private readonly settings: SettingsService,
    private readonly session: SessionService,
  ) {
    super();
  }

  @Option({ flags: '-p, --profile <name>', description: 'Profile to use' })
  parseProfile(v: string): string {
    return v;
  }

  @Option({ flags: '--api <url>', description: 'Override the API base URL' })
  parseApi(v: string): string {
    return v;
  }

  async run(_params: string[], options: LogoutOptions): Promise<void> {
    const resolved = this.settings.resolve(options);
    await this.session.logout(resolved.profile, resolved.baseUrl);
    process.stdout.write(`Signed out of "${resolved.profile}".\n`);
  }
}
```

`cli/src/commands/auth/whoami.command.ts`:

```ts
import { Command, CommandRunner, Option } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';

/** Shape of GET /auth/me — mirrors `UserProfile` in api/src/features/auth/auth.types.ts. */
interface UserProfile {
  id: string | null;
  kind: string;
  role?: string;
  email?: string;
  displayName?: string | null;
}

interface WhoamiOptions {
  profile?: string;
  api?: string;
  json?: boolean;
}

@Command({ name: 'whoami', description: 'Show the authenticated principal' })
export class WhoamiCommand extends CommandRunner {
  constructor(
    private readonly settings: SettingsService,
    private readonly clients: ClientFactory,
  ) {
    super();
  }

  @Option({ flags: '-p, --profile <name>', description: 'Profile to use' })
  parseProfile(v: string): string {
    return v;
  }

  @Option({ flags: '--api <url>', description: 'Override the API base URL' })
  parseApi(v: string): string {
    return v;
  }

  @Option({ flags: '--json', description: 'Emit raw JSON' })
  parseJson(): boolean {
    return true;
  }

  async run(_params: string[], options: WhoamiOptions): Promise<void> {
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);
    const me = await client.get<UserProfile>('/auth/me');

    if (options.json) {
      process.stdout.write(`${JSON.stringify(me, null, 2)}\n`);
      return;
    }

    process.stdout.write(
      [
        `profile  ${resolved.profile}`,
        `api      ${resolved.baseUrl}`,
        `id       ${me.id ?? '—'}`,
        `kind     ${me.kind}`,
        `role     ${me.role ?? '—'}`,
        `email    ${me.email ?? '—'}`,
        `name     ${me.displayName ?? '—'}`,
      ].join('\n') + '\n',
    );
  }
}
```

`cli/src/commands/auth/sessions.command.ts`:

```ts
import { Command, CommandRunner, Option } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';

/** One row of GET /auth/sessions. */
interface SessionRow {
  id: string;
  userAgent?: string | null;
  ip?: string | null;
  createdAt: string;
  expiresAt: string;
}

interface SessionsOptions {
  profile?: string;
  api?: string;
  json?: boolean;
}

@Command({ name: 'sessions', description: 'List active sessions' })
export class SessionsCommand extends CommandRunner {
  constructor(
    private readonly settings: SettingsService,
    private readonly clients: ClientFactory,
  ) {
    super();
  }

  @Option({ flags: '-p, --profile <name>', description: 'Profile to use' })
  parseProfile(v: string): string {
    return v;
  }

  @Option({ flags: '--api <url>', description: 'Override the API base URL' })
  parseApi(v: string): string {
    return v;
  }

  @Option({ flags: '--json', description: 'Emit raw JSON' })
  parseJson(): boolean {
    return true;
  }

  async run(_params: string[], options: SessionsOptions): Promise<void> {
    const resolved = this.settings.resolve(options);
    const rows = await this.clients.create(resolved).get<SessionRow[]>('/auth/sessions');

    if (options.json) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
      return;
    }

    if (rows.length === 0) {
      process.stdout.write('No active sessions.\n');
      return;
    }

    for (const row of rows) {
      process.stdout.write(
        `${row.id}\t${row.ip ?? '—'}\t${row.expiresAt}\t${row.userAgent ?? '—'}\n`,
      );
    }
  }
}
```

- [ ] **Step 6: Register the commands**

In `cli/src/app.module.ts`, add the imports and append to `providers`:

```ts
import { LoginCommand } from './commands/auth/login.command';
import { LogoutCommand } from './commands/auth/logout.command';
import { SessionsCommand } from './commands/auth/sessions.command';
import { WhoamiCommand } from './commands/auth/whoami.command';
```

```ts
    LoginCommand,
    LogoutCommand,
    WhoamiCommand,
    SessionsCommand,
```

- [ ] **Step 7: Verify end to end against the running API**

With `api` running and a seeded account:

```bash
cd cli && pnpm build
node dist/cyb.js config profile add dev --api http://localhost:3000 --email <your-account>
node dist/cyb.js login
node dist/cyb.js whoami
node dist/cyb.js sessions
node dist/cyb.js logout
node dist/cyb.js whoami        # expect exit code 3
echo $?
```

Expected: `login` prompts for a password and confirms; `whoami` prints the principal; `sessions` lists at least one row; after `logout`, `whoami` prints the login hint and `echo $?` prints `3`.

- [ ] **Step 8: Verify the session survives across invocations**

Run `node dist/cyb.js whoami` twice in a row after a single login. Expected: both succeed without re-prompting.

- [ ] **Step 9: Verify concurrent invocations do not revoke the session**

```bash
node dist/cyb.js login
for i in 1 2 3 4 5; do node dist/cyb.js whoami & done; wait
node dist/cyb.js whoami
```

Expected: all six succeed. A failure here means the lock is not doing its job in the real binary, even if Task 5's test passed.

- [ ] **Step 10: Run the whole suite**

Run: `cd cli && pnpm verify`
Expected: typecheck clean, all tests pass.

- [ ] **Step 11: Commit**

```bash
git add cli/
git commit -m "feat(cli): add login, logout, whoami and sessions commands"
```

---

## Done Criteria

- `cyb config profile add|use|ls` manages profiles.
- `cyb login` authenticates and persists a session at 0600.
- `cyb whoami` and `cyb sessions` succeed on a later, separate invocation.
- Five concurrent `cyb whoami` invocations trigger exactly one `/auth/refresh` and leave the session intact.
- `cyb whoami` after `cyb logout` exits 3.
- `pnpm codegen` regenerates `src/generated/`; `pnpm codegen:check` is clean.
- `pnpm verify` passes.
