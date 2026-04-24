import postgres from 'postgres';
import { config } from '../config.js';

export const sql = postgres(config.databaseUrl, {
  max: config.dbPoolMax,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: config.dbSsl ? 'require' : false,
  prepare: true,
});

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
