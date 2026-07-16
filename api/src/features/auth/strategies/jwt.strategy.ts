import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Principal } from '../../../common/principal';
import type { AuthConfig } from '../../../config/configurations/auth.config';
import type { AccessTokenClaims } from '../auth.types';

/** Validates the Bearer access token on protected requests. */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    const cfg = config.getOrThrow<AuthConfig>('auth');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: cfg.jwtAccessSecret,
      issuer: cfg.issuer,
      algorithms: ['HS256'],
    });
  }

  validate(payload: AccessTokenClaims): Principal {
    return { id: payload.sub, role: payload.role };
  }
}
