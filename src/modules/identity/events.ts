import { EventEmitter } from 'node:events';

export type AuthEvent =
  | { type: 'login_success';    userId: string; sessionId: string; ip?: string; ua?: string }
  | { type: 'login_failure';    email?: string; ip?: string; reason: 'bad_password' | 'unknown_email' | 'rate_limited' }
  | { type: 'logout';           userId: string; sessionId: string }
  | { type: 'session_revoked';  userId: string; sessionId: string; by: 'user' | 'password_change' | 'expiry' }
  | { type: 'password_changed'; userId: string }
  | { type: 'user_created';     userId: string; via: 'cli' | 'register' };

export const authEvents = new EventEmitter();
