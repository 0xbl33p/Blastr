/**
 * Trade panel — sell the dev's just-launched position.
 *
 * Phase 1: sell-only via Printr's own swap ix. Same program as the launch,
 * works immediately for curve-stage tokens (no waiting for Jupiter to index
 * the new pool). Buy-any-CA via Jupiter is Phase 2.
 *
 * Callback IDs:
 *   trade:open:<tokenId>             → render the panel
 *   trade:close:<tokenId>            → close the panel (delete the message)
 *   trade:sell:<tokenId>:<percent>   → ask for confirmation
 *   trade:do:<tokenId>:<percent>     → actually execute the sell
 */
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { Markup } from 'telegraf';
import type { BotContext } from './context.js';
import { tokenStore, type UserTokenRecord } from '../store/tokens.js';
import { walletStore } from '../store/wallets.js';
import { buildSellIx, getTelecoinBalance } from '../printr/sell.js';
import { cleanSend } from './helpers.js';
import { mainMenuKeyboard, shortTokenId } from './keyboards.js';
import { esc } from './format.js';
import { logger } from '../logger.js';
import { config } from '../config.js';

const RPC_TIMEOUT_MS = 8_000;

/** Wrap an awaitable so it can't hang the per-chat update queue. */
function withTimeout<T>(p: Promise<T>, ms = RPC_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`rpc timeout after ${ms}ms`)), ms),
    ),
  ]);
}

function solanaConn(): Connection {
  return new Connection(config.solanaRpcUrl, 'confirmed');
}

// ── keyboards ──

export function tradePanelKeyboard(tokenId: string) {
  const sid = shortTokenId(tokenId);
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('Sell 25%', `trade:sell:${sid}:25`),
      Markup.button.callback('Sell 50%', `trade:sell:${sid}:50`),
    ],
    [
      Markup.button.callback('Sell 75%', `trade:sell:${sid}:75`),
      Markup.button.callback('Sell 100%', `trade:sell:${sid}:100`),
    ],
    [
      Markup.button.callback('🔄 Refresh', `trade:open:${sid}`),
      Markup.button.callback('❌ Close', `trade:close:${sid}`),
    ],
  ]);
}

function confirmSellKeyboard(tokenId: string, percent: number) {
  const sid = shortTokenId(tokenId);
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Confirm', `trade:do:${sid}:${percent}`),
      Markup.button.callback('❌ Cancel', `trade:open:${sid}`),
    ],
  ]);
}

// ── public renderer used post-launch and from /mytokens ──

export async function renderTradePanel(ctx: BotContext, tokenId: string): Promise<void> {
  const userId = ctx.from!.id.toString();
  const record = await tokenStore.getByTokenId(userId, tokenId);
  if (!record) {
    await cleanSend(ctx, '⚠️ Token not found in your launch history.', mainMenuKeyboard());
    return;
  }
  if (!record.swapContext) {
    await cleanSend(
      ctx,
      `🪙 <b>$${esc(record.symbol ?? '?')}</b>\n\nThis token was launched before sell support shipped, so we don't have its swap accounts cached. Sell it via Printr's app for now.`,
      mainMenuKeyboard(),
    );
    return;
  }

  // Solana-only sell support in Phase 1.
  const onSolana = record.chains.some((c) => c.startsWith('solana:'));
  if (!onSolana) {
    await cleanSend(
      ctx,
      `🪙 <b>$${esc(record.symbol ?? '?')}</b>\n\nSell support is Solana-only in this version (Phase 3 will add EVM).`,
      mainMenuKeyboard(),
    );
    return;
  }

  const svmWallet = (await walletStore.getUserWallets(userId)).wallets.find((w) => w.type === 'svm');
  if (!svmWallet) {
    await cleanSend(ctx, '⚠️ No Solana wallet found. Add one via /wallet.', mainMenuKeyboard());
    return;
  }

  const conn = solanaConn();
  const balance = await withTimeout(
    getTelecoinBalance(
      conn,
      new PublicKey(svmWallet.address),
      new PublicKey(record.swapContext.telecoinMint),
    ),
  ).catch((err) => {
    logger.warn({ err, userId, tokenId }, 'balance lookup failed/timed out');
    return 0n;
  });

  const balanceStr = balance > 0n
    ? `${(Number(balance) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${esc(record.symbol ?? '')}`
    : '0 (nothing to sell)';

  const appUrl = config.printrBaseUrl.replace('api-preview', 'app');
  const lines = [
    `🪙 <b>$${esc(record.symbol ?? '?')}</b> · ${esc(record.name ?? '(unnamed)')}`,
    '',
    `<b>Holdings:</b> ${balanceStr}`,
    `<a href="${appUrl}/trade/${record.tokenId}">View on Printr</a>`,
    '',
    '<i>Sell a percentage of your position:</i>',
  ];
  await cleanSend(ctx, lines.join('\n'), tradePanelKeyboard(record.tokenId));
}

// ── callback router ──

export async function handleTradeCallback(ctx: BotContext, data: string): Promise<void> {
  const userId = ctx.from!.id.toString();

  if (data.startsWith('trade:open:')) {
    const tokenId = data.slice(11);
    return renderTradePanel(ctx, tokenId);
  }

  if (data.startsWith('trade:close:')) {
    try {
      await ctx.deleteMessage();
    } catch {
      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      } catch {}
    }
    return;
  }

  if (data.startsWith('trade:sell:')) {
    const [, , tokenId, percentStr] = data.split(':');
    const percent = parseInt(percentStr, 10);
    if (!Number.isFinite(percent) || percent < 1 || percent > 100) return;
    const record = await tokenStore.getByTokenId(userId, tokenId);
    if (!record) {
      await cleanSend(ctx, '⚠️ Token not found.', mainMenuKeyboard());
      return;
    }
    await cleanSend(
      ctx,
      `⚠️ <b>Confirm sell</b>\n\nSell <b>${percent}%</b> of your <b>$${esc(record.symbol ?? '?')}</b> position?\n\n` +
        `<i>v1: no on-chain slippage protection — you accept whatever price the curve gives. Add slippage settings comes in v2.</i>`,
      confirmSellKeyboard(tokenId, percent),
    );
    return;
  }

  if (data.startsWith('trade:do:')) {
    const [, , tokenId, percentStr] = data.split(':');
    const percent = parseInt(percentStr, 10);
    if (!Number.isFinite(percent) || percent < 1 || percent > 100) return;
    await executeSell(ctx, tokenId, percent);
    return;
  }
}

async function executeSell(ctx: BotContext, tokenId: string, percent: number): Promise<void> {
  const userId = ctx.from!.id.toString();
  const record = await tokenStore.getByTokenId(userId, tokenId);
  if (!record || !record.swapContext) {
    await cleanSend(ctx, '⚠️ Cannot build sell — missing swap context for this token.', mainMenuKeyboard());
    return;
  }
  const svmWallet = (await walletStore.getUserWallets(userId)).wallets.find((w) => w.type === 'svm');
  if (!svmWallet) {
    await cleanSend(ctx, '⚠️ No Solana wallet found.', mainMenuKeyboard());
    return;
  }

  await cleanSend(ctx, `⏳ Selling ${percent}% of $${esc(record.symbol ?? '?')}...`);

  try {
    const conn = solanaConn();
    const owner = new PublicKey(svmWallet.address);
    const mint = new PublicKey(record.swapContext.telecoinMint);

    const balance = await getTelecoinBalance(conn, owner, mint);
    if (balance === 0n) {
      await cleanSend(ctx, `⚠️ Zero balance — nothing to sell.`, mainMenuKeyboard());
      return;
    }

    // For 100% we send the full balance; otherwise compute pro-rata. We round
    // down (BigInt division floors) so we never try to sell more than we hold.
    const sellAmount = percent === 100 ? balance : (balance * BigInt(percent)) / 100n;
    if (sellAmount === 0n) {
      await cleanSend(ctx, `⚠️ Computed sell amount is zero (rounding). Try a larger %.`, mainMenuKeyboard());
      return;
    }

    const sellIx = buildSellIx({
      payer: owner,
      telecoinMint: mint,
      sellAmount,
      ctx: record.swapContext,
    });

    const key = await walletStore.decryptKey(userId, svmWallet.id);
    const keypair = Keypair.fromSecretKey(bs58.decode(key));
    const { blockhash } = await conn.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: owner,
      recentBlockhash: blockhash,
      instructions: [sellIx],
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([keypair]);

    const sig = await conn.sendRawTransaction(tx.serialize(), {
      // Helius standard tier rejects preflight — skip it.
      skipPreflight: true,
      preflightCommitment: 'confirmed',
    });
    const confirmation = await conn.confirmTransaction(sig, 'confirmed');
    if (confirmation.value.err) {
      throw new Error(`tx reverted: ${JSON.stringify(confirmation.value.err)}`);
    }

    const humanSold = (Number(sellAmount) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 2 });
    await cleanSend(
      ctx,
      `✅ <b>Sold ${percent}%</b>\n\n${humanSold} ${esc(record.symbol ?? '')} → SOL\n<b>Sig:</b> <code>${sig}</code>`,
      mainMenuKeyboard(),
    );
    logger.info({ userId, tokenId, percent, sellAmount: sellAmount.toString(), sig }, 'sell executed');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ err, userId, tokenId, percent }, 'sell failed');
    await cleanSend(ctx, `❌ Sell failed: ${esc(msg)}`, mainMenuKeyboard());
  }
}
