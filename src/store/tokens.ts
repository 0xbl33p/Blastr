import { sql } from '../db/index.js';

export interface UserTokenRecord {
  tokenId: string;
  symbol: string | null;
  name: string | null;
  chains: string[];
  createdAt: Date;
}

interface UserTokenRow {
  token_id: string;
  symbol: string | null;
  name: string | null;
  chains: string[] | null;
  created_at: Date;
}

class TokenStore {
  /** Record a successful Printr launch. Idempotent — duplicates are ignored. */
  async record(
    userId: string,
    tokenId: string,
    name: string,
    symbol: string,
    chains: string[],
  ): Promise<void> {
    await sql`
      INSERT INTO user_tokens (user_id, token_id, symbol, name, chains)
      VALUES (${userId}, ${tokenId}, ${symbol}, ${name}, ${chains})
      ON CONFLICT (user_id, token_id) DO NOTHING
    `;
  }

  /** List the user's launches, newest first. */
  async list(userId: string, limit = 20): Promise<UserTokenRecord[]> {
    const rows = await sql<UserTokenRow[]>`
      SELECT token_id, symbol, name, chains, created_at
      FROM user_tokens
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      tokenId: r.token_id,
      symbol: r.symbol,
      name: r.name,
      chains: r.chains ?? [],
      createdAt: r.created_at,
    }));
  }
}

export const tokenStore = new TokenStore();
