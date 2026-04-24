import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} environment variable is required`);
  return v;
}

function bool(v: string | undefined, defaultValue: boolean): boolean {
  if (v === undefined || v === '') return defaultValue;
  return v === '1' || v.toLowerCase() === 'true';
}

const databaseUrl = process.env.DATABASE_URL ?? '';
// Default to SSL when the URL points anywhere other than localhost.
const dbSslDefault = databaseUrl
  ? !/(@|\/)(localhost|127\.0\.0\.1)/.test(databaseUrl)
  : false;

export const config = {
  // ── runtime ──
  port: parseInt(process.env.PORT ?? '3000', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  // ── telegram ──
  botToken: process.env.BOT_TOKEN ?? '',
  webhookDomain: process.env.WEBHOOK_DOMAIN ?? '',
  webhookSecret: process.env.WEBHOOK_SECRET ?? '',
  webhookPath: '/tg/webhook',

  // ── data layer ──
  databaseUrl,
  dbPoolMax: parseInt(process.env.DB_POOL_MAX ?? '10', 10),
  dbSsl: bool(process.env.DB_SSL, dbSslDefault),
  redisUrl: process.env.REDIS_URL ?? '',

  // ── crypto ──
  walletEncryptionKey: process.env.WALLET_ENCRYPTION_KEY ?? '',

  // ── printr ──
  printrApiKey:
    process.env.PRINTR_API_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhaS1pbnRlZ3JhdGlvbiJ9.PZsqfleSmSiAra8jiN3JZvDSonoawQLnvYRyPHDbtRg',
  printrBaseUrl: process.env.PRINTR_API_BASE_URL ?? 'https://api-preview.printr.money',
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? '',

  // ── blastr launch fee ──
  blastrFeeSol: parseFloat(process.env.BLASTR_FEE_SOL ?? '0.05'),
  blastrFeeRecipientSvm: process.env.BLASTR_FEE_RECIPIENT_SVM ?? '',
  blastrFeeWei: process.env.BLASTR_FEE_WEI ?? '0',
  blastrFeeRecipientEvm: process.env.BLASTR_FEE_RECIPIENT_EVM ?? '',
} as const;

export function validateConfig(): void {
  required('BOT_TOKEN');
  required('WALLET_ENCRYPTION_KEY');
  required('DATABASE_URL');
  required('REDIS_URL');
  // Validate KEK shape early so we crash on boot, not on first wallet op.
  const k = config.walletEncryptionKey;
  const buf = k.length === 64 ? Buffer.from(k, 'hex') : Buffer.from(k, 'base64');
  if (buf.length !== 32) {
    throw new Error(
      'WALLET_ENCRYPTION_KEY must decode to 32 bytes (use `openssl rand -base64 32`)',
    );
  }
}

export function isWebhookMode(): boolean {
  return Boolean(config.webhookDomain && config.webhookSecret);
}
