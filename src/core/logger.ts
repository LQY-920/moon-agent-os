import pino from 'pino';

export function createLogger(level: string, pretty: boolean) {
  return pino({
    level,
    redact: {
      paths: [
        'password',
        'newPassword',
        'oldPassword',
        'token',
        'rawToken',
        'mao_sess',
        'req.headers.authorization',
        'req.headers.cookie',
        'password_hash',
        '*.password',
        '*.token',
        '*.rawToken',
      ],
      censor: '[REDACTED]',
    },
    transport: pretty
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        }
      : undefined,
  });
}

export type Logger = ReturnType<typeof createLogger>;
