import { Redis } from 'ioredis';
import { config } from './config.js';
import { logger } from './logger.js';

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
  // Retry with exponential backoff up to ~10s.
  retryStrategy: (times: number) => Math.min(times * 200, 10_000),
});

redis.on('error', (err: Error) => {
  logger.error({ err: err.message }, 'redis error');
});

redis.on('connect', () => {
  logger.info('redis connected');
});

const SESSION_PREFIX = 'sess:';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface SessionStore<T> {
  get: (name: string) => Promise<T | undefined>;
  set: (name: string, value: T) => Promise<void>;
  delete: (name: string) => Promise<void>;
}

export function createRedisSessionStore<T>(): SessionStore<T> {
  return {
    async get(key) {
      const raw = await redis.get(SESSION_PREFIX + key);
      return raw ? (JSON.parse(raw) as T) : undefined;
    },
    async set(key, value) {
      await redis.set(
        SESSION_PREFIX + key,
        JSON.stringify(value),
        'EX',
        SESSION_TTL_SECONDS,
      );
    },
    async delete(key) {
      await redis.del(SESSION_PREFIX + key);
    },
  };
}

export async function closeRedis(): Promise<void> {
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
}
