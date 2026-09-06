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
