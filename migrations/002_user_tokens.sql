-- ── user_tokens ──
-- One row per token a user has launched through blastr. Lets us render the
-- "My Tokens" view without re-querying Printr's API for everything.
-- We track at the user_id (Telegram) level rather than wallet, so adding a
-- new wallet later doesn't lose the user's launch history.

CREATE TABLE IF NOT EXISTS user_tokens (
  user_id     BIGINT       NOT NULL,
  token_id    TEXT         NOT NULL,
  symbol      TEXT,
  name        TEXT,
  chains      TEXT[],
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, token_id)
);

CREATE INDEX IF NOT EXISTS user_tokens_user_id_created_idx
  ON user_tokens (user_id, created_at DESC);
