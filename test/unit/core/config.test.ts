import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('core/config', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    // 清掉所有 APP 前缀 env,重新设置
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('APP_') || k.startsWith('SESSION_') || k.startsWith('RATE_') || k === 'DATABASE_URL' || k === 'PORT' || k === 'LOG_LEVEL' || k === 'NODE_ENV') {
        delete process.env[k];
      }
    }
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('loads valid config', async () => {
    process.env.NODE_ENV = 'development';
    process.env.APP_ORIGIN = 'http://localhost:3000';
    process.env.PORT = '3000';
    process.env.DATABASE_URL = 'mysql://root:password@localhost:3306/moon_agent_os';
    process.env.SESSION_COOKIE_NAME = 'mao_sess';
    process.env.SESSION_MAX_AGE_DAYS = '30';
    process.env.SESSION_SLIDING_UPDATE_MINUTES = '1';
    process.env.RATE_LIMIT_IP_WINDOW_MIN = '10';
    process.env.RATE_LIMIT_IP_MAX = '20';
    process.env.RATE_LIMIT_EMAIL_WINDOW_MIN = '10';
    process.env.RATE_LIMIT_EMAIL_MAX = '5';
    process.env.LOG_LEVEL = 'info';

    const { loadConfig } = await import('../../../src/core/config');
    const cfg = loadConfig();
    expect(cfg.nodeEnv).toBe('development');
    expect(cfg.port).toBe(3000);
    expect(cfg.session.maxAgeDays).toBe(30);
  });

  it('throws when required env missing', async () => {
    // 不设置 DATABASE_URL
    process.env.NODE_ENV = 'development';
    const { loadConfig } = await import('../../../src/core/config');
    expect(() => loadConfig()).toThrow();
  });
});
