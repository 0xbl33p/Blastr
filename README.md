# ⚡ blastr

Telegram-native token launcher built on the [Printr](https://printr.money) API.
Multi-chain launches in a few taps, without ever leaving Telegram.

**Try it:** [@printrblasterbot](https://t.me/printrblasterbot)

---

## What it does

- **Wallet management** — create or import EVM and Solana wallets directly in Telegram. Private keys are encrypted at rest with AES-256-GCM.
- **One-tap launches** — pick chains, set initial buy + graduation, confirm. blastr quotes via Printr, signs locally, and submits.
- **Quick Launch presets** — save your default chains, supply, fees, and graduation thresholds. Skip the wizard for repeat launches.

## Commands

| Command | What it does |
|---|---|
| `/start` | Main menu |
| `/wallet` | Wallet manager (create / import / export / set default) |
| `/launch` | Full guided launch wizard |
| `/quicklaunch` | One-shot launch using your saved preset |
| `/settings` | Edit your Quick Launch preset |
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
- **Data:** Postgres (wallets + presets) via [`postgres`](https://github.com/porsager/postgres), Redis-backed sessions via [`ioredis`](https://github.com/redis/ioredis)
- **Crypto:** AES-256-GCM with a dedicated wallet encryption key (separate from `BOT_TOKEN`)
- **Logging:** [`pino`](https://github.com/pinojs/pino) structured JSON, with secret redaction
- **Chains:** [`@solana/web3.js`](https://github.com/solana-labs/solana-web3.js) + [`ethers`](https://github.com/ethers-io/ethers.js)

## Local development

Requires Node 22+, a Postgres database, and Redis.

```bash
# 1. Install dependencies
npm install

# 2. Generate a 32-byte wallet encryption key
openssl rand -base64 32

# 3. Copy the env template and fill in:
#    - BOT_TOKEN (from @BotFather)
#    - WALLET_ENCRYPTION_KEY (from step 2)
#    - DATABASE_URL  (e.g. postgres://user:pass@localhost:5432/blastr)
#    - REDIS_URL     (e.g. redis://localhost:6379)
cp .env.example .env

# 4. Run in watch mode (long-polling — no public URL needed)
npm run dev
```

For production deploys, set `WEBHOOK_DOMAIN` and `WEBHOOK_SECRET` and the bot will switch to webhook mode automatically.

See [`.env.example`](./.env.example) for the full env var reference.

## Architecture notes

- **Stateless bot process** — all state lives in Postgres (wallets, presets) or Redis (sessions). Containers are interchangeable.
- **Idempotent migrations** run on boot from `migrations/*.sql`.
- **Webhook intake** with `X-Telegram-Bot-Api-Secret-Token` verification — spoofed POSTs are rejected before reaching the handler.
- **Graceful shutdown** drains in-flight handlers, then closes DB and Redis cleanly on `SIGTERM`.
- **Crash isolation** — Telegraf `bot.catch` + `uncaughtException` boundaries keep one bad update from killing the process.

---

## License

**All rights reserved.** This repository is published as source-available for transparency only. No license is granted to copy, modify, fork, redistribute, sublicense, or use this code or any derivative work, in whole or in part, for any purpose.

If you'd like to use blastr's code or partner on something, reach out.

© 2026 blastr. All rights reserved.
