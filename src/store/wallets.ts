import { randomBytes } from 'node:crypto';
import { sql } from '../db/index.js';
import { encrypt, decrypt } from '../crypto.js';

export type WalletType = 'evm' | 'svm';

export interface StoredWallet {
  id: string;          // public 8-hex short_id (used in callback_data)
  label: string;
  type: WalletType;
  address: string;
  createdAt: string;
  // The raw encrypted blob is no longer carried on the public type;
  // call decryptKey(wallet) to retrieve the plaintext private key.
}

interface WalletRow {
  id: string;
  short_id: string;
  user_id: string;
  label: string;
  type: WalletType;
  address: string;
  encrypted_key: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  is_default: boolean;
  created_at: Date;
}

interface UserWallets {
  defaultWalletId: string | null;
  wallets: StoredWallet[];
}

function shortId(): string {
  return randomBytes(4).toString('hex');
}

function rowToWallet(r: WalletRow): StoredWallet {
  return {
    id: r.short_id,
    label: r.label,
    type: r.type,
    address: r.address,
    createdAt: r.created_at.toISOString(),
  };
}

class WalletStore {
  /** Decrypt a wallet's private key. Re-fetches the encrypted blob from DB
   *  so we never have to ship it through the StoredWallet shape. */
  async decryptKey(userId: string, walletId: string): Promise<string> {
    const [row] = await sql<Pick<WalletRow, 'encrypted_key' | 'iv' | 'auth_tag'>[]>`
      SELECT encrypted_key, iv, auth_tag
      FROM wallets
      WHERE user_id = ${userId} AND short_id = ${walletId}
      LIMIT 1
    `;
    if (!row) throw new Error('wallet not found');
    return decrypt({
      ciphertext: row.encrypted_key,
      iv: row.iv,
      authTag: row.auth_tag,
    });
  }

  async getUserWallets(userId: string): Promise<UserWallets> {
    const rows = await sql<WalletRow[]>`
      SELECT id, short_id, user_id, label, type, address,
             encrypted_key, iv, auth_tag, is_default, created_at
      FROM wallets
      WHERE user_id = ${userId}
      ORDER BY created_at ASC
    `;
    const wallets = rows.map(rowToWallet);
    const defaultRow = rows.find((r) => r.is_default);
    return {
      defaultWalletId: defaultRow?.short_id ?? null,
      wallets,
    };
  }

  async getWallet(userId: string, walletId: string): Promise<StoredWallet | undefined> {
    const [row] = await sql<WalletRow[]>`
      SELECT id, short_id, user_id, label, type, address,
             encrypted_key, iv, auth_tag, is_default, created_at
      FROM wallets
      WHERE user_id = ${userId} AND short_id = ${walletId}
      LIMIT 1
    `;
    return row ? rowToWallet(row) : undefined;
  }

  async getDefaultWallet(userId: string): Promise<StoredWallet | undefined> {
    const [row] = await sql<WalletRow[]>`
      SELECT id, short_id, user_id, label, type, address,
             encrypted_key, iv, auth_tag, is_default, created_at
      FROM wallets
      WHERE user_id = ${userId}
      ORDER BY is_default DESC, created_at ASC
      LIMIT 1
    `;
    return row ? rowToWallet(row) : undefined;
  }

  /** Pick the user's wallet for a given chain type. Prefers the user's
   *  default wallet when its type matches; falls back to the oldest wallet
   *  of that type. Without the is_default preference, callers using
   *  `wallets.find(w => w.type === ...)` would always pick wallet #1
   *  regardless of which one the user marked as default. */
  async getWalletForType(userId: string, type: WalletType): Promise<StoredWallet | undefined> {
    const [row] = await sql<WalletRow[]>`
      SELECT id, short_id, user_id, label, type, address,
             encrypted_key, iv, auth_tag, is_default, created_at
      FROM wallets
      WHERE user_id = ${userId} AND type = ${type}
      ORDER BY is_default DESC, created_at ASC
      LIMIT 1
    `;
    return row ? rowToWallet(row) : undefined;
  }

  async addWallet(
    userId: string,
    type: WalletType,
    address: string,
    privateKey: string,
    label?: string,
  ): Promise<StoredWallet> {
    const blob = encrypt(privateKey);

    return await sql.begin(async (tx) => {
      const [{ count }] = await tx<{ count: string }[]>`
        SELECT COUNT(*)::text AS count
        FROM wallets
        WHERE user_id = ${userId}
      `;
      const isFirst = parseInt(count, 10) === 0;

      const [{ count: typeCount }] = await tx<{ count: string }[]>`
        SELECT COUNT(*)::text AS count
        FROM wallets
        WHERE user_id = ${userId} AND type = ${type}
      `;
      const autoLabel =
        type === 'evm' ? `EVM #${parseInt(typeCount, 10) + 1}` : `Solana #${parseInt(typeCount, 10) + 1}`;

      // Generate a non-colliding short_id within this user's namespace.
      let sid = shortId();
      for (let i = 0; i < 5; i++) {
        const [hit] = await tx<{ exists: boolean }[]>`
          SELECT EXISTS(
            SELECT 1 FROM wallets WHERE user_id = ${userId} AND short_id = ${sid}
          ) AS exists
        `;
        if (!hit?.exists) break;
        sid = shortId();
      }

      const [row] = await tx<WalletRow[]>`
        INSERT INTO wallets (
          user_id, short_id, label, type, address,
          encrypted_key, iv, auth_tag, is_default
        ) VALUES (
          ${userId}, ${sid}, ${label ?? autoLabel}, ${type}, ${address},
          ${blob.ciphertext}, ${blob.iv}, ${blob.authTag}, ${isFirst}
        )
        RETURNING id, short_id, user_id, label, type, address,
                  encrypted_key, iv, auth_tag, is_default, created_at
      `;
      return rowToWallet(row);
    });
  }

  async removeWallet(userId: string, walletId: string): Promise<boolean> {
    return await sql.begin(async (tx) => {
      const [removed] = await tx<{ is_default: boolean }[]>`
        DELETE FROM wallets
        WHERE user_id = ${userId} AND short_id = ${walletId}
        RETURNING is_default
      `;
      if (!removed) return false;
      if (removed.is_default) {
        // Promote the oldest remaining wallet to default.
        await tx`
          UPDATE wallets
          SET is_default = true
          WHERE id = (
            SELECT id FROM wallets
            WHERE user_id = ${userId}
            ORDER BY created_at ASC
            LIMIT 1
          )
        `;
      }
      return true;
    });
  }

  async setDefault(userId: string, walletId: string): Promise<void> {
    await sql.begin(async (tx) => {
      // Clear current default first to satisfy the partial unique index.
      await tx`
        UPDATE wallets SET is_default = false
        WHERE user_id = ${userId} AND is_default = true
      `;
      await tx`
        UPDATE wallets SET is_default = true
        WHERE user_id = ${userId} AND short_id = ${walletId}
      `;
    });
  }

  async userHasType(userId: string, type: WalletType): Promise<boolean> {
    const [hit] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS(
        SELECT 1 FROM wallets WHERE user_id = ${userId} AND type = ${type}
      ) AS exists
    `;
    return Boolean(hit?.exists);
  }

  async getUserWalletTypes(userId: string): Promise<Set<WalletType>> {
    const rows = await sql<{ type: WalletType }[]>`
      SELECT DISTINCT type FROM wallets WHERE user_id = ${userId}
    `;
    return new Set(rows.map((r) => r.type));
  }
}

export const walletStore = new WalletStore();
