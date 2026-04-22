import { z } from 'zod';
import { MESSAGE_ROLES } from './domain/message';

export const CreateConversationInput = z.object({
  title: z.string()
    .max(200)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional(),
});
export type CreateConversationInput = z.infer<typeof CreateConversationInput>;

export const AddMessageInput = z.object({
  role: z.enum(MESSAGE_ROLES as unknown as [string, ...string[]]),
  content: z.string().min(1).max(65535),
});
export type AddMessageInput = z.infer<typeof AddMessageInput>;

export const ListConversationsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
});
export type ListConversationsQuery = z.infer<typeof ListConversationsQuery>;

export const ListMessagesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  cursor: z.string().optional(),
});
export type ListMessagesQuery = z.infer<typeof ListMessagesQuery>;

export const ConversationIdParam = z.object({
  id: z.string().length(26),
});
export type ConversationIdParam = z.infer<typeof ConversationIdParam>;