import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sql } from './index.js';
import { logger } from '../logger.js';

const MIGRATIONS_DIR = resolve('migrations');

export async function runMigrations(): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    const [existing] = await sql<{ version: string }[]>`
      SELECT version FROM schema_migrations WHERE version = ${version}
    `;
    if (existing) {
      logger.debug({ version }, 'migration already applied');
      continue;
    }

    const body = await readFile(resolve(MIGRATIONS_DIR, file), 'utf-8');
    logger.info({ version }, 'applying migration');
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (version) VALUES (${version})`;
    });
    logger.info({ version }, 'migration applied');
  }
}
