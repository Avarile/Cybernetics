import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ConversationKind, PrincipalRef } from '../mastra.types';
import { ConversationRepository } from '../repositories/conversation.repository';

/**
 * Resolves/creates the Mastra-thread-backed conversation for a principal and
 * enforces ownership: a conversation may only be read/continued by the user
 * who owns it (or a principal with no id, e.g. system/schedule triggers).
 */
@Injectable()
export class ConversationService {
  constructor(private readonly repo: ConversationRepository) {}

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
      if (!existing) throw new NotFoundException('Conversation not found');
      if (
        principal.id &&
        existing.ownerUserId &&
        existing.ownerUserId !== principal.id
      ) {
        throw new ForbiddenException('Not your conversation');
      }
      return existing;
    }
    return this.repo.create({
      ownerUserId: principal.id,
      resourceId: this.resourceOf(principal),
      kind,
    } as never);
  }

  /** Page of conversations owned by the principal; empty for anonymous principals. */
  async listForOwner(principal: PrincipalRef, page = 1, limit = 20) {
    if (!principal.id) return [];
    return this.repo.listByOwner(principal.id, page, limit);
  }

  /** Fetch a conversation by id, 404 if missing, 403 if not owned by the principal. */
  async getOwned(principal: PrincipalRef, id: string) {
    const conv = await this.repo.findLiveById(id);
    if (!conv) throw new NotFoundException('Conversation not found');
    if (principal.id && conv.ownerUserId && conv.ownerUserId !== principal.id) {
      throw new ForbiddenException('Not your conversation');
    }
    return conv;
  }

  /** Bump activity metadata (last message time / count) on a conversation. */
  async touch(id: string): Promise<void> {
    await this.repo.touch(id);
  }
}
