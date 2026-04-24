import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  APP_ORIGIN: z.string().url(),
  PORT: z.coerce.number().int().positive(),
  DATABASE_URL: z.string().startsWith('mysql://'),
  SESSION_COOKIE_NAME: z.string().min(1),
  SESSION_MAX_AGE_DAYS: z.coerce.number().int().positive(),
  SESSION_SLIDING_UPDATE_MINUTES: z.coerce.number().int().positive(),
  RATE_LIMIT_IP_WINDOW_MIN: z.coerce.number().int().positive(),
  RATE_LIMIT_IP_MAX: z.coerce.number().int().positive(),
  RATE_LIMIT_EMAIL_WINDOW_MIN: z.coerce.number().int().positive(),
  RATE_LIMIT_EMAIL_MAX: z.coerce.number().int().positive(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1),
});

export type Config = {
  nodeEnv: 'development' | 'production' | 'test';
  appOrigin: string;
  port: number;
  databaseUrl: string;
  session: {
    cookieName: string;
    maxAgeDays: number;
    slidingUpdateMinutes: number;
  };
  rateLimit: {
    ipWindowMin: number;
    ipMax: number;
    emailWindowMin: number;
    emailMax: number;
  };
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  llm: {
    apiKey: string;
    model: string;
  };
};

export function loadConfig(): Config {
  const parsed = ConfigSchema.parse(process.env);
  return {
    nodeEnv: parsed.NODE_ENV,
    appOrigin: parsed.APP_ORIGIN,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    session: {
      cookieName: parsed.SESSION_COOKIE_NAME,
      maxAgeDays: parsed.SESSION_MAX_AGE_DAYS,
      slidingUpdateMinutes: parsed.SESSION_SLIDING_UPDATE_MINUTES,
    },
    rateLimit: {
      ipWindowMin: parsed.RATE_LIMIT_IP_WINDOW_MIN,
      ipMax: parsed.RATE_LIMIT_IP_MAX,
      emailWindowMin: parsed.RATE_LIMIT_EMAIL_WINDOW_MIN,
      emailMax: parsed.RATE_LIMIT_EMAIL_MAX,
    },
    logLevel: parsed.LOG_LEVEL,
    llm: {
      apiKey: parsed.LLM_API_KEY,
      model: parsed.LLM_MODEL,
    },
  };
}
