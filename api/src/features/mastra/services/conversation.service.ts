import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  ErrorCode,
  ExceptionService,
} from '../../../infrastructure/exceptions';
import { isAdmin, userIdOrNull } from '../../../common/principal';
import {
  type AgentId,
  DEFAULT_AGENT_ID,
  resolveAgentId,
  THREAD_STORE,
} from '../mastra.constants';
import type {
  ConversationKind,
  ConversationStatus,
  PrincipalRef,
  ThreadStore,
} from '../mastra.types';
import {
  ConversationRepository,
  type ConversationListRow,
} from '../repositories/conversation.repository';
import { SystemAuditService } from '../../system/system-audit.service';
import { sanitizeTitle } from './conversation-title';

/** The conversation shape the client sees — no ownership or storage internals. */
export interface PublicConversation {
  id: string;
  title: string | null;
  /** Which agent this conversation is bound to; the picker renders it. */
  agentId: AgentId;
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
    agentId: resolveAgentId(row.agentId),
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
 * enforces ownership: a conversation may be read/continued only by the user who
 * owns it, or by an admin. An unowned conversation (`ownerUserId IS NULL`,
 * which is what system/schedule triggers create) is admin-only.
 */
@Injectable()
export class ConversationService {
  constructor(
    private readonly repo: ConversationRepository,
    private readonly errors: ExceptionService,
    // Optional so a module-subset e2e context that does not import
    // SystemAuditModule still boots; the access check itself never depends on it.
    @Optional() private readonly audit?: SystemAuditService,
    // Optional for the same reason. Only `remove` uses it, to purge the Mastra
    // thread; without it the metadata row is still soft-deleted.
    @Optional() @Inject(THREAD_STORE) private readonly threads?: ThreadStore,
  ) {}

  private resourceOf(p: PrincipalRef): string {
    return userIdOrNull(p) ?? 'system';
  }

  /**
   * Authorize a read/continue of an existing conversation.
   *
   * Fails closed on a NULL `ownerUserId`. The previous predicate —
   * `principal.id && conv.ownerUserId && conv.ownerUserId !== principal.id` —
   * short-circuited whenever the row had no owner, and system/scheduled runs
   * create exactly such rows. That let any authenticated caller read a system
   * conversation's transcript, continue it, and (because the approval path
   * gates on this same method) approve its pending `send-email` / `db-write`
   * tool call. A conversation with no owner is now system-owned: admin only.
   */
  private async assertCanAccess(
    principal: PrincipalRef,
    conv: { id: string; ownerUserId: string | null },
  ): Promise<void> {
    const userId = userIdOrNull(principal);
    if (isAdmin(principal)) {
      // Admins may read any conversation, but reading someone else's private
      // AI transcript should leave a trace. Only cross-owner reads are logged —
      // an admin in their own conversation is unremarkable.
      if (conv.ownerUserId !== userId) {
        await this.audit?.record({
          ctx: { actorId: userId },
          action: 'conversation.admin_read',
          entityType: 'conversation',
          entityId: conv.id,
          metadata: { ownerUserId: conv.ownerUserId },
        });
      }
      return;
    }
    if (!userId || conv.ownerUserId !== userId) {
      throw this.errors.create(ErrorCode.FORBIDDEN, {
        message: 'Not your conversation',
      });
    }
  }

  /**
   * Return the live conversation for `conversationId` (403 if the principal may
   * not access it), or create a new one owned by the principal.
   */
  async ensure(
    principal: PrincipalRef,
    conversationId?: string,
    kind: ConversationKind = 'chat',
    agentId: AgentId = DEFAULT_AGENT_ID,
  ) {
    if (conversationId) {
      const existing = await this.repo.findLiveById(conversationId);
      if (!existing) {
        throw this.errors.create(ErrorCode.AGENT_CONVERSATION_NOT_FOUND);
      }
      await this.assertCanAccess(principal, existing);
      // `agentId` is deliberately NOT applied here. The binding is fixed at
      // creation: Mastra memory is per-thread, so re-pointing a live thread at
      // another agent hands a different persona someone else's working memory
      // and history. A caller passing a new one on an existing conversation is
      // ignored rather than refused — the client locks its picker once a
      // conversation has messages, so reaching this branch means a stale tab,
      // not a mistake worth a 422.
      return existing;
    }
    return this.repo.create({
      // `userIdOrNull`, not the raw subject id: `owner_user_id` references
      // `users.id`, so a service credential's id here is an FK violation.
      ownerUserId: userIdOrNull(principal),
      resourceId: this.resourceOf(principal),
      kind,
      agentId,
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
    status: ConversationStatus | 'all' = 'active',
  ): Promise<{
    data: PublicConversation[];
    total: number;
    page: number;
    limit: number;
  }> {
    const userId = userIdOrNull(principal);
    if (!userId) return { data: [], total: 0, page, limit };
    const { rows, total } = await this.repo.listByOwner(
      userId,
      page,
      limit,
      status,
    );
    return { data: rows.map(toPublicConversation), total, page, limit };
  }

  /** Fetch a conversation by id, 404 if missing, 403 if the principal may not access it. */
  async getOwned(principal: PrincipalRef, id: string) {
    const conv = await this.repo.findLiveById(id);
    if (!conv) throw this.errors.create(ErrorCode.AGENT_CONVERSATION_NOT_FOUND);
    await this.assertCanAccess(principal, conv);
    return conv;
  }

  /**
   * Set or clear the user's title override.
   *
   * A blank title stores `null` rather than an empty string, which puts the row
   * back on the Mastra-generated title (see `toPublicConversation`) instead of
   * leaving the rail showing "Untitled" forever. `sanitizeTitle` is the same
   * normaliser the read path uses, so a renamed title cannot be longer or
   * differently-whitespaced than a generated one.
   */
  async rename(
    principal: PrincipalRef,
    id: string,
    title: string | null,
  ): Promise<PublicConversation> {
    const conv = await this.getOwned(principal, id);
    await this.repo.rename(conv.id, sanitizeTitle(title));
    return this.publicById(conv.id);
  }

  /** Move a conversation between the active and archived shelves. */
  async setStatus(
    principal: PrincipalRef,
    id: string,
    status: ConversationStatus,
  ): Promise<PublicConversation> {
    const conv = await this.getOwned(principal, id);
    await this.repo.setStatus(conv.id, status);
    return this.publicById(conv.id);
  }

  /**
   * Delete a conversation: soft-delete our metadata row, then purge the
   * transcript from Mastra's own tables.
   *
   * The two halves are deliberately asymmetric. Our row must survive as a
   * tombstone — `agent_run` and `agent_approval` hold foreign keys to it, and
   * the audit ledger is the thing a deletion must NOT be able to erase. The
   * messages are not ours and carry no such references, so "delete" means what
   * the user thinks it means for the content itself.
   *
   * A failure to reach Mastra's store is swallowed: the metadata row is already
   * gone from every listing, and throwing here would report a failed delete for
   * a conversation the user can no longer see.
   */
  async remove(principal: PrincipalRef, id: string): Promise<void> {
    const conv = await this.getOwned(principal, id);
    await this.repo.softDelete(conv.id);
    try {
      await this.threads?.deleteThread(conv.id);
    } catch {
      // Tombstone stands; the orphaned thread is storage cost, not a data leak
      // (nothing can reach it — every read path goes through a live row).
    }
  }

  /** Re-read a row through the same projection the list endpoint returns. */
  private async publicById(id: string): Promise<PublicConversation> {
    const row = await this.repo.findLivePublicById(id);
    if (!row) throw this.errors.create(ErrorCode.AGENT_CONVERSATION_NOT_FOUND);
    return toPublicConversation(row);
  }

  /** Bump activity metadata (last message time / count) on a conversation. */
  async touch(id: string): Promise<void> {
    await this.repo.touch(id);
  }
}
