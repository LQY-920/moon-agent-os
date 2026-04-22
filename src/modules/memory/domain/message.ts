export type MessageRole = 'user' | 'ai' | 'system';

export const MESSAGE_ROLES: readonly MessageRole[] = ['user', 'ai', 'system'] as const;

export type Message = {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
};
