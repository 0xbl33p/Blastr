-- ── user_tokens.swap_context ──
-- At launch time we capture the per-token accounts Printr's swap instruction
-- needs (dbc_pool, dbc_config, damm_pool, etc.) so we can build sell ixs later
-- without re-querying Printr or re-deriving them. JSONB stays flexible if
-- Printr ever adds/removes accounts in a program upgrade — the IDL update
-- workflow surfaces breaking changes via `npm run update-idl`.

ALTER TABLE user_tokens ADD COLUMN IF NOT EXISTS swap_context JSONB;
