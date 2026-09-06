import { Injectable, Optional } from '@nestjs/common';
import { UsageError } from '../errors';
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
      throw new UsageError(
        `Unknown profile "${profile}". ` +
          `Add it with: cyb config profile add ${profile} --api <url>`,
      );
    }

    const baseUrl = explicitUrl ?? entry?.baseUrl;
    if (!baseUrl) {
      throw new UsageError(
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
