import { z } from 'zod';

export const LoginInput = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(256),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const ChangePasswordInput = z.object({
  oldPassword: z.string().min(1).max(256),
  newPassword: z.string().min(12).max(256),
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordInput>;

export const SessionIdParam = z.object({
  id: z.string().length(26),
});

export const CreateUserInput = z.object({
  email: z.string().email().max(255),
  password: z.string().min(12).max(256),
  displayName: z.string().min(1).max(64),
});
export type CreateUserInput = z.infer<typeof CreateUserInput>;
