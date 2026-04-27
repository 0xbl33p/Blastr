import { sql } from '../db/index.js';

/** Per-token swap accounts captured from the launch payload, used to build
 *  sell ixs later without re-querying Printr. Keys mirror Printr's swap
 *  instruction account list (see src/printr/sell.ts). */
export interface SwapContext {
  /** SPL mint address of the launched token (Printr token_id is a separate handle). */
  telecoinMint: string;
  quoteMint: string;
  dbcConfig: string;
  dbcPool: string;
  dbcPoolAuthority: string;
  dbcTelecoinVault: string;
  dbcQuoteVault: string;
  dbcEventAuthority: string;
  dbcMigrationMetadata: string;
  dammPrintrPartnerConfig: string;
  dammPool: string;
  dammPoolAuthority: string;
  dammTelecoinVault: string;
  dammQuoteVault: string;
  dammPositionNftAccount: string;
  dammPosition: string;
  dammEventAuthority: string;
  quoteTokenProgram: string;
}

export interface UserTokenRecord {
  tokenId: string;
  symbol: string | null;
  name: string | null;
  chains: string[];
  createdAt: Date;
  swapContext: SwapContext | null;
}

interface UserTokenRow {
  token_id: string;
  symbol: string | null;
  name: string | null;
  chains: string[] | null;
  created_at: Date;
  swap_context: SwapContext | null;
}

class TokenStore {
  /** Record a successful Printr launch. Idempotent — duplicates are ignored. */
  async record(
    userId: string,
    tokenId: string,
    name: string,
    symbol: string,
    chains: string[],
    swapContext: SwapContext | null = null,
  ): Promise<void> {
    await sql`
      INSERT INTO user_tokens (user_id, token_id, symbol, name, chains, swap_context)
      VALUES (
        ${userId}, ${tokenId}, ${symbol}, ${name}, ${chains},
        ${swapContext ? sql.json(swapContext as never) : null}
      )
      ON CONFLICT (user_id, token_id) DO UPDATE
        SET swap_context = COALESCE(EXCLUDED.swap_context, user_tokens.swap_context)
    `;
  }

  /** List the user's launches, newest first. */
  async list(userId: string, limit = 20): Promise<UserTokenRecord[]> {
    const rows = await sql<UserTokenRow[]>`
      SELECT token_id, symbol, name, chains, created_at, swap_context
      FROM user_tokens
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map(rowToRecord);
  }

  /** Fetch a single token belonging to the user. Accepts either a full token_id
   *  or a short prefix (Telegram's 64-byte callback_data limit forces us to
   *  truncate when round-tripping the id through buttons). Hex/base58 token
   *  ids contain no LIKE wildcards (`%` / `_`), so the prefix match is safe. */
  async getByTokenId(userId: string, tokenIdOrPrefix: string): Promise<UserTokenRecord | undefined> {
    const [row] = await sql<UserTokenRow[]>`
      SELECT token_id, symbol, name, chains, created_at, swap_context
      FROM user_tokens
      WHERE user_id = ${userId} AND token_id LIKE ${tokenIdOrPrefix + '%'}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    return row ? rowToRecord(row) : undefined;
  }
}

function rowToRecord(r: UserTokenRow): UserTokenRecord {
  return {
    tokenId: r.token_id,
    symbol: r.symbol,
    name: r.name,
    chains: r.chains ?? [],
    createdAt: r.created_at,
    swapContext: r.swap_context,
  };
}

export const tokenStore = new TokenStore();
