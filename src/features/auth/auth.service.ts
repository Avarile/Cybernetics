import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { UserRow } from '../../infrastructure/database/schema/identity.schema';
import { UserRepository } from '../users/user.repository';
import type { TokenPair } from './auth.types';
import { PasswordService } from './password.service';
import { SessionRepository } from './session.repository';
import { TokenService } from './token.service';

export interface RequestContext {
  userAgent?: string;
  ip?: string;
}

/** A sanitized view of an active session (never exposes the token hash). */
export interface SessionSummary {
  id: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
  userAgent: string | null;
  ip: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordService,
  ) {}

  /** Used by LocalStrategy. Uniform 401 — never reveals which factor failed. */
  async validateUser(email: string, password: string): Promise<UserRow> {
    if (typeof email !== 'string' || typeof password !== 'string') {
      throw new UnauthorizedException('Invalid credentials');
    }
    const user = await this.users.findByEmail(email.toLowerCase());
    const ok = user
      ? await this.passwords.verify(user.passwordHash, password)
      : false;
    if (!user || !ok) throw new UnauthorizedException('Invalid credentials');
    return user;
  }

  async login(user: UserRow, ctx: RequestContext): Promise<TokenPair> {
    const familyId = this.tokens.newFamilyId();
    const pair = await this.issuePair(user, familyId, ctx);
    await this.users.stampLogin(user.id);
    return pair;
  }

  async refresh(refreshToken: string, ctx: RequestContext): Promise<TokenPair> {
    const tokenHash = this.tokens.hashToken(refreshToken);
    const session = await this.sessions.findByTokenHash(tokenHash);
    if (!session) throw new UnauthorizedException('Invalid refresh token');

    if (session.revokedAt) {
      // Replay of a rotated/revoked token → assume theft; revoke the family.
      await this.sessions.revokeFamily(session.familyId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = await this.users.findActiveById(session.userId);
    if (!user) throw new UnauthorizedException('Invalid refresh token');

    await this.sessions.revokeById(session.id);
    return this.issuePair(user, session.familyId, ctx);
  }

  async logout(refreshToken: string): Promise<void> {
    const session = await this.sessions.findByTokenHash(
      this.tokens.hashToken(refreshToken),
    );
    if (session && !session.revokedAt) {
      await this.sessions.revokeById(session.id);
    }
  }

  async logoutAll(userId: string): Promise<void> {
    await this.sessions.revokeAllForUser(userId);
  }

  async changePassword(
    userId: string,
    current: string,
    next: string,
  ): Promise<void> {
    const user = await this.users.findActiveById(userId);
    if (!user || !(await this.passwords.verify(user.passwordHash, current))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    await this.users.update(userId, {
      passwordHash: await this.passwords.hash(next),
    });
    await this.sessions.revokeAllForUser(userId); // force re-login everywhere
  }

  async listSessions(userId: string): Promise<SessionSummary[]> {
    const rows = await this.sessions.listActiveForUser(userId);
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt ?? null,
      expiresAt: r.expiresAt,
      userAgent: r.userAgent ?? null,
      ip: r.ip ?? null,
    }));
  }

  private async issuePair(
    user: UserRow,
    familyId: string,
    ctx: RequestContext,
  ): Promise<TokenPair> {
    const accessToken = this.tokens.signAccessToken({
      sub: user.id,
      role: user.role,
      email: user.email,
      kind: 'user',
    });
    const refresh = this.tokens.generateRefreshToken();
    await this.sessions.create({
      userId: user.id,
      tokenHash: refresh.tokenHash,
      familyId,
      expiresAt: this.tokens.refreshExpiry(),
      userAgent: ctx.userAgent,
      ip: ctx.ip,
    });
    return {
      accessToken,
      refreshToken: refresh.token,
      expiresIn: this.tokens.accessTtl(),
    };
  }
}
