import type { Kysely } from 'kysely';
import { ulid } from 'ulid';
import type { Database } from '../../../core/db';
import type { Conversation } from '../domain/conversation';
import type { Message, MessageRole } from '../domain/message';
import { ConversationNotFoundError, ConversationForbiddenError } from '../domain/errors';
import type { ConversationRepository } from '../repositories/conversation.repository';
import type { MessageRepository } from '../repositories/message.repository';

export class MemoryService {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly db: Kysely<Database>,
  ) {}

  async createConversation(userId: string, input: { title?: string | null }): Promise<Conversation> {
    const id = ulid();
    const now = new Date();
    const title = input.title ?? null;
    await this.conversations.insert({ id, userId, title, now });
    return { id, userId, title, createdAt: now, updatedAt: now };
  }

  async getConversation(userId: string, id: string): Promise<Conversation> {
    const conv = await this.conversations.findById(id);
    if (!conv) throw new ConversationNotFoundError();
    if (conv.userId !== userId) throw new ConversationForbiddenError();
    return conv;
  }

  async listConversations(userId: string, opts: { limit: number; cursor?: string | null }):
    Promise<{ items: Conversation[]; nextCursor: string | null }> {
    return this.conversations.listByUser(userId, opts);
  }

  async deleteConversation(userId: string, id: string): Promise<void> {
    await this.getConversation(userId, id);
    await this.conversations.deleteById(id);
  }

  // addMessage / listMessages 下一 Task 加
}
