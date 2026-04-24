import { z } from 'zod';

export const SendMessageBody = z.object({
  message: z.string().min(1).max(10000),
});
export type SendMessageBody = z.infer<typeof SendMessageBody>;

export const ConversationIdParam = z.object({
  id: z.string().length(26),
});
export type ConversationIdParam = z.infer<typeof ConversationIdParam>;