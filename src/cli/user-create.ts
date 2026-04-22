import * as readline from 'node:readline/promises';
import { loadConfig } from '../core/config';
import { createDb } from '../core/db';
import { UserRepository } from '../modules/identity/repositories/user.repository';
import { IdentityRepository } from '../modules/identity/repositories/identity.repository';
import { LoginAttemptRepository } from '../modules/identity/repositories/login-attempt.repository';
import { SessionRepository } from '../modules/identity/repositories/session.repository';
import { PasswordService } from '../modules/identity/services/password.service';
import { SessionService } from '../modules/identity/services/session.service';
import { AuthService } from '../modules/identity/services/auth.service';
import { CreateUserInput } from '../modules/identity/schema';

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.+)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function readSecret(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const answer = await rl.question(prompt);
  rl.close();
  return answer;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email;
  const displayName = args.name;
  if (!email || !displayName) {
    console.error('Usage: pnpm user:create --email=<email> --name=<display-name>');
    process.exit(1);
  }
  const password = await readSecret('Password (输入后回车,不会写入 shell history): ');

  const parsed = CreateUserInput.safeParse({ email, password, displayName });
  if (!parsed.success) {
    console.error('参数校验失败:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }

  const cfg = loadConfig();
  const { db } = createDb(cfg.databaseUrl);
  const users = new UserRepository(db);
  const identities = new IdentityRepository(db);
  const attempts = new LoginAttemptRepository(db);
  const sessionsRepo = new SessionRepository(db);
  const passwords = new PasswordService();
  const sessions = new SessionService(sessionsRepo, {
    maxAgeDays: cfg.session.maxAgeDays,
    slidingUpdateMinutes: cfg.session.slidingUpdateMinutes,
  });
  const auth = new AuthService(users, identities, attempts, passwords, sessions);

  try {
    const id = await auth.register({
      email: parsed.data.email,
      password: parsed.data.password,
      displayName: parsed.data.displayName,
      via: 'cli',
      now: new Date(),
    });
    console.log(`Created user ${id} (${parsed.data.email})`);
  } catch (err) {
    console.error('创建失败:', err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error('bootstrap failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
