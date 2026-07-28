import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  ExceptionService,
} from '../../../infrastructure/exceptions';
import type { ConversationKind, PrincipalRef } from '../mastra.types';
import {
  ConversationRepository,
  type ConversationListRow,
} from '../repositories/conversation.repository';
import { sanitizeTitle } from './conversation-title';

/** The conversation shape the client sees — no ownership or storage internals. */
export interface PublicConversation {
  id: string;
  title: string | null;
  kind: ConversationKind;
  status: string;
  lastMessageAt: Date | null;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * `title` is an explicit override (backfilled, or renamed by a user later);
 * when unset we fall back to the title Mastra generated for the thread.
 */
function toPublicConversation(row: ConversationListRow): PublicConversation {
  return {
    id: row.id,
    title: sanitizeTitle(row.title) ?? sanitizeTitle(row.generatedTitle),
    kind: row.kind,
    status: row.status,
    lastMessageAt: row.lastMessageAt,
    messageCount: row.messageCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Resolves/creates the Mastra-thread-backed conversation for a principal and
 * enforces ownership: a conversation may only be read/continued by the user
 * who owns it (or a principal with no id, e.g. system/schedule triggers).
 */
@Injectable()
export class ConversationService {
  constructor(
    private readonly repo: ConversationRepository,
    private readonly errors: ExceptionService,
  ) {}

  private resourceOf(p: PrincipalRef): string {
    return p.id ?? 'system';
  }

  /**
   * Return the live conversation for `conversationId` (403 if the principal
   * doesn't own it), or create a new one owned by the principal.
   */
  async ensure(
    principal: PrincipalRef,
    conversationId?: string,
    kind: ConversationKind = 'chat',
  ) {
    if (conversationId) {
      const existing = await this.repo.findLiveById(conversationId);
      if (!existing) {
        throw this.errors.create(ErrorCode.AGENT_CONVERSATION_NOT_FOUND);
      }
      if (
        principal.id &&
        existing.ownerUserId &&
        existing.ownerUserId !== principal.id
      ) {
        throw this.errors.create(ErrorCode.FORBIDDEN, {
          message: 'Not your conversation',
        });
      }
      return existing;
    }
    return this.repo.create({
      ownerUserId: principal.id,
      resourceId: this.resourceOf(principal),
      kind,
    } as never);
  }

  /**
   * Page of conversations owned by the principal; empty for anonymous ones.
   *
   * Returns the `{ data, total, page, limit }` envelope every paginated list in
   * this API uses (cf. `UsersService.list`) — the history rail reads `.data`.
   */
  async listForOwner(
    principal: PrincipalRef,
    page = 1,
    limit = 20,
  ): Promise<{
    data: PublicConversation[];
    total: number;
    page: number;
    limit: number;
  }> {
    if (!principal.id) return { data: [], total: 0, page, limit };
    const { rows, total } = await this.repo.listByOwner(
      principal.id,
      page,
      limit,
    );
    return { data: rows.map(toPublicConversation), total, page, limit };
  }

  /** Fetch a conversation by id, 404 if missing, 403 if not owned by the principal. */
  async getOwned(principal: PrincipalRef, id: string) {
    const conv = await this.repo.findLiveById(id);
    if (!conv) throw this.errors.create(ErrorCode.AGENT_CONVERSATION_NOT_FOUND);
    if (principal.id && conv.ownerUserId && conv.ownerUserId !== principal.id) {
      throw this.errors.create(ErrorCode.FORBIDDEN, {
        message: 'Not your conversation',
      });
    }
    return conv;
  }

  /** Bump activity metadata (last message time / count) on a conversation. */
  async touch(id: string): Promise<void> {
    await this.repo.touch(id);
  }
}
