import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'blastr' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'BOT_TOKEN',
      'botToken',
      'WALLET_ENCRYPTION_KEY',
      'walletEncryptionKey',
      'PRINTR_API_KEY',
      'printrApiKey',
      'OPENROUTER_API_KEY',
      'openrouterApiKey',
      'WEBHOOK_SECRET',
      'webhookSecret',
      'DATABASE_URL',
      'databaseUrl',
      'REDIS_URL',
      'redisUrl',
      'privateKey',
      '*.privateKey',
      'encryptedKey',
      '*.encryptedKey',
    ],
    censor: '[REDACTED]',
  },
});
