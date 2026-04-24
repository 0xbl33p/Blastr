import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from './config.js';

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = config.walletEncryptionKey;
  // Accept either base64 (44-char) or hex (64-char) — both decode to 32 bytes.
  const buf = raw.length === 64
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(
      'WALLET_ENCRYPTION_KEY must decode to 32 bytes (use `openssl rand -base64 32`)',
    );
  }
  cachedKey = buf;
  return cachedKey;
}

export interface EncryptedBlob {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export function encrypt(plaintext: string): EncryptedBlob {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

export function decrypt(blob: EncryptedBlob): string {
  const decipher = createDecipheriv('aes-256-gcm', key(), blob.iv);
  decipher.setAuthTag(blob.authTag);
  const plain = Buffer.concat([
    decipher.update(blob.ciphertext),
    decipher.final(),
  ]);
  return plain.toString('utf-8');
}
