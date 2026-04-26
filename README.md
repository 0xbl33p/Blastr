<p align="center">
  <img src="assets/logo.png" alt="blastr logo" width="260"/>
</p>

<h1 align="center">⚡ blastr</h1>

<p align="center">
  Telegram-native token launcher built on the <a href="https://printr.money">Printr</a> API.<br/>
  Multi-chain launches in a few taps, without ever leaving Telegram.
</p>

<p align="center">
  <a href="https://t.me/printrblasterbot"><b>Try it → @printrblasterbot</b></a>
</p>

---

## What it does

- **Wallet management** — create or import EVM and Solana wallets directly in Telegram. Private keys are encrypted at rest with AES-256-GCM, stored in Postgres.
- **One-tap launches** — pick chains, set initial buy in SOL, confirm. blastr quotes via Printr, signs locally, submits as a single atomic transaction.
- **Atomic buy + auto-stake** — when launching with `stake_pool` fee sink, your initial buy is locked into the stake pool in the *same* transaction as the launch. No race against sniper bots — you're guaranteed to be the first staker.
- **Quick Launch presets** — save your defaults (chain, supply, fees, graduation, stake settings). Skip the wizard for repeat launches.
- **My Tokens** — `/mytokens` lists every launch, with chain icons and direct links to Printr.

## Commands

| Command | What it does |
|---|---|
| `/start` | Main menu |
| `/wallet` | Wallet manager (create / import / export / set default) |
| `/launch` | Full guided launch wizard with per-step Back navigation |
| `/quicklaunch` | One-shot launch using your saved preset |
| `/mytokens` | List the tokens you've launched, with links |
| `/settings` | Edit your Quick Launch preset (defaults, auto-stake, lock period) |
| `/quote` | Get a Printr quote without launching |
| `/status <token_id>` | Check deployment status |
| `/help` | How it works |

## Supported chains

🔵 Base · 💎 Ethereum · 🔹 Arbitrum · 🟡 BNB Chain · 🔺 Avalanche
🟣 Monad · 🟢 Mantle · 🦄 Unichain · ⚡ HyperEVM · 🌐 MegaETH
⚛️ Plasma · ☀️ Solana

## Tech stack

- **Runtime:** Node 22 LTS, TypeScript (NodeNext, strict)
- **Bot framework:** [Telegraf](https://github.com/telegraf/telegraf) on webhooks (long-polling fallback for dev)
- **Data:** Postgres (wallets, presets, launch history) via [`postgres`](https://github.com/porsager/postgres); Redis-backed sessions via [`ioredis`](https://github.com/redis/ioredis)
- **Crypto:** AES-256-GCM, dedicated `WALLET_ENCRYPTION_KEY` decoupled from the bot token
- **Logging:** [`pino`](https://github.com/pinojs/pino) structured JSON, with secret redaction
- **Chains:** [`@solana/web3.js`](https://github.com/solana-labs/solana-web3.js) + [`ethers`](https://github.com/ethers-io/ethers.js)
- **On-chain integration:** Printr is an Anchor program — we pull its IDL on-chain from the IDL PDA, pin it to `src/printr/idl.json`, and hand-roll the instructions (no Anchor SDK runtime dep). `npm run update-idl` re-fetches and diffs against the pinned copy so we never silently absorb breaking changes.

## Local development

Requires Node 22+, a Postgres database, and Redis.

```bash
# 1. Install dependencies
npm install

# 2. Generate the wallet encryption key (32-byte AES key, base64-encoded)
openssl rand -base64 32

# 3. Generate the webhook secret (only needed in production)
openssl rand -hex 32

# 4. Copy the env template and fill in at minimum:
#    - BOT_TOKEN (from @BotFather)
#    - WALLET_ENCRYPTION_KEY (from step 2)
#    - DATABASE_URL  (e.g. postgres://user:pass@localhost:5432/blastr)
#    - REDIS_URL     (e.g. redis://localhost:6379)
cp .env.example .env

# 5. Run in watch mode (long-polling — no public URL needed)
npm run dev
```

For production deploys, set `WEBHOOK_DOMAIN` and `WEBHOOK_SECRET` — the bot switches to webhook mode automatically.

See [`.env.example`](./.env.example) for the full env var reference.

### Updating Printr's IDL

When Printr ships a new program version, fetch the latest IDL:

```bash
npm run update-idl
```

This pulls from the on-chain IDL PDA, diffs against `src/printr/idl.json`, prints a summary of any changed/added/removed instructions, and saves the new copy. Review the diff (`git diff src/printr/idl.json`), commit, and redeploy.

## Architecture highlights

- **Stateless bot process** — all state lives in Postgres (wallets, presets, launch history) or Redis (sessions). Containers are interchangeable; horizontal replicas just work.
- **Idempotent migrations** run on boot from `migrations/*.sql`. Each migration is recorded in `schema_migrations`.
- **Webhook intake** with `X-Telegram-Bot-Api-Secret-Token` header verification. Spoofed POSTs are rejected at the HTTP layer before reaching the bot.
- **Graceful shutdown** drains in-flight handlers, then closes DB and Redis cleanly on `SIGTERM`.
- **Crash isolation** — Telegraf `bot.catch` + `uncaughtException` boundaries keep one bad update from killing the process.
- **Atomic auto-stake** — when fee sink is `stake_pool`, the launch tx bundles `print_telecoin2` (create) + `swap` (initial buy) + `refresh_staking2` + `create_stake_position` in one Solana versioned transaction. Either the whole launch+stake lands together, or nothing does. Lookup tables keep the tx under the 1232-byte cap.
- **Treasury fee** — a configurable `BLASTR_FEE_SOL` (default 0.05) is prepended to the launch tx as a transfer to `BLASTR_FEE_RECIPIENT_SVM`. Same atomic guarantees: fee + launch succeed or fail together.

## Roadmap

### Phase 1 — Sell dev position (in progress)
- Post-launch trade panel with `Sell 25 / 50 / 75 / 100%` quick buttons
- Re-accessible from `/mytokens` (tap any launched token to open its trade panel)
- Sell execution via Printr's own `swap` instruction — same program we already use for launches, works immediately for curve-stage tokens (no waiting for Jupiter to index the new pool)

### Phase 2 — Buy any CA via Jupiter
- Paste any Solana token address, see name + price (Jupiter quote API)
- Buy with quick-amount buttons
- Sell graduated tokens via Jupiter (better routing than direct Meteora calls)
- Slippage settings per token

### Phase 3 — EVM trading
- Buy/sell across the supported EVM chains (Base, Ethereum, Arbitrum, BNB, Avalanche, Monad, Mantle, Unichain, HyperEVM, MegaETH, Plasma)
- Aggregator integration (1inch / 0x / Odos depending on chain coverage)
- Per-chain gas + slippage tuning

---

## License

**All rights reserved.** This repository is published as source-available for transparency only. No license is granted to copy, modify, fork, redistribute, sublicense, or use this code or any derivative work, in whole or in part, for any purpose.

If you'd like to use blastr's code or partner on something, reach out.

© 2026 blastr. All rights reserved.
