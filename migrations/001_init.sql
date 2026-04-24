-- ── wallets ──
-- One row per stored wallet. user_id is the Telegram user id.
-- Keys are stored encrypted at rest with AES-256-GCM (see src/crypto.ts).
-- short_id is the public 8-hex handle exposed in callback_data so the
-- existing keyboard/callback wiring keeps working.

CREATE TABLE IF NOT EXISTS wallets (
  id              BIGSERIAL    PRIMARY KEY,
  user_id         BIGINT       NOT NULL,
  short_id        TEXT         NOT NULL,
  label           TEXT         NOT NULL,
  type            TEXT         NOT NULL CHECK (type IN ('svm', 'evm')),
  address         TEXT         NOT NULL,
  encrypted_key   BYTEA        NOT NULL,
  iv              BYTEA        NOT NULL,
  auth_tag        BYTEA        NOT NULL,
  is_default      BOOLEAN      NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wallets_user_id_idx
  ON wallets (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS wallets_short_id_per_user_idx
  ON wallets (user_id, short_id);

CREATE UNIQUE INDEX IF NOT EXISTS wallets_one_default_per_user_idx
  ON wallets (user_id) WHERE is_default = true;

-- ── user_presets ──
-- One row per Telegram user. JSONB blob holds the QuickLaunchPreset.

CREATE TABLE IF NOT EXISTS user_presets (
  user_id     BIGINT       PRIMARY KEY,
  data        JSONB        NOT NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
