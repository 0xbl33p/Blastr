import { existsSync } from 'fs';
import { resolve } from 'path';
import { Input } from 'telegraf';
import type { BotContext } from './context.js';
import { printr, PrintrApiError } from '../printr/client.js';
import { CHAINS, chainLabel } from '../printr/chains.js';
import { walletStore } from '../store/wallets.js';
import { tokenStore } from '../store/tokens.js';
import { config } from '../config.js';
import {
  generateEvmWallet,
  generateSolanaWallet,
  importEvmWallet,
  importSolanaWallet,
} from '../wallet/generate.js';
import { getBalance } from '../wallet/balance.js';
import { generateQrBuffer } from '../wallet/qr.js';
import {
  mainMenuKeyboard,
  walletListKeyboard,
  walletTypeKeyboard,
  walletDetailKeyboard,
  walletDeleteConfirmKeyboard,
  walletRequiredKeyboard,
  chainKeyboard,
} from './keyboards.js';
import { formatQuote, formatDeployments, esc } from './format.js';
import { cleanSend, cleanSendPhoto, cleanSendAnimation, deleteUserMsg } from './helpers.js';

const BANNER_GIF = resolve('assets', 'banner.gif');
const BANNER_MP4 = resolve('assets', 'banner.mp4');
const BANNER_PNG = resolve('assets', 'banner.png');

// ── /start ──

export async function startCommand(ctx: BotContext) {
  const name = ctx.from?.first_name ?? 'anon';
  const caption =
    `<b>⚡ blastr</b>\n\ngm ${esc(name)}! blast tokens to any chain via Printr.`;

  if (existsSync(BANNER_MP4)) {
    await cleanSendAnimation(ctx, Input.fromLocalFile(BANNER_MP4), caption, mainMenuKeyboard());
  } else if (existsSync(BANNER_GIF)) {
    await cleanSendAnimation(ctx, Input.fromLocalFile(BANNER_GIF), caption, mainMenuKeyboard());
  } else if (existsSync(BANNER_PNG)) {
    await cleanSendPhoto(ctx, Input.fromLocalFile(BANNER_PNG), caption, mainMenuKeyboard());
  } else {
    await cleanSend(ctx, caption, mainMenuKeyboard());
  }
}

// ── /help ──

export async function helpCommand(ctx: BotContext) {
  await cleanSend(
    ctx,
    `<b>⚡ blastr — How it works</b>\n\n` +
      `1. Create or import a wallet with 👛 <b>Wallet</b>\n` +
      `2. Fund your wallet (QR code provided)\n` +
      `3. Tap 🚀 <b>Launch Token</b> to start\n` +
      `4. Pick chain(s), set initial buy, confirm\n` +
      `5. blastr auto-signs and deploys\n\n` +
      `<b>Supported chains:</b>\n` +
      CHAINS.map((c) => `  ${c.emoji} ${c.name}`).join('\n'),
    mainMenuKeyboard(),
  );
}

// ── /wallet — dashboard ──

export async function walletDashboard(ctx: BotContext) {
  const userId = ctx.from!.id.toString();
  const { wallets, defaultWalletId } = await walletStore.getUserWallets(userId);

  if (wallets.length === 0) {
    await cleanSend(
      ctx,
      '<b>👛 Wallet Manager</b>\n\n' +
        'No wallets yet. Create or import one to start launching tokens.',
      walletListKeyboard([], null),
    );
  } else {
    const lines = wallets.map((w) => {
      const icon = w.type === 'evm' ? '💎' : '☀️';
      const def = w.id === defaultWalletId ? ' ⭐' : '';
      return `${icon} <b>${esc(w.label)}</b>${def}\n   <code>${w.address}</code>`;
    });
    await cleanSend(
      ctx,
      `<b>👛 Your Wallets</b> (${wallets.length})\n\n` + lines.join('\n\n'),
      walletListKeyboard(wallets, defaultWalletId),
    );
  }
}

// ── Wallet callback router ──

export async function handleWalletCallbacks(ctx: BotContext, data: string) {
  const userId = ctx.from!.id.toString();

  // w:create → type picker
  if (data === 'w:create') {
    await cleanSend(ctx, '➕ <b>Create Wallet</b>\n\nSelect type:', walletTypeKeyboard('create'));
    return;
  }

  // w:import → type picker
  if (data === 'w:import') {
    await cleanSend(ctx, '📥 <b>Import Wallet</b>\n\nSelect type:', walletTypeKeyboard('import'));
    return;
  }

  // w:create:evm / w:create:svm
  if (data === 'w:create:evm' || data === 'w:create:svm') {
    const type = data.endsWith('evm') ? 'evm' as const : 'svm' as const;
    const gen = type === 'evm' ? generateEvmWallet() : generateSolanaWallet();
    const wallet = await walletStore.addWallet(userId, type, gen.address, gen.privateKey);

    // Send private key (auto-deletes in 60s)
    const keyMsg = await ctx.reply(
      `🔑 <b>SAVE YOUR PRIVATE KEY NOW</b>\n\n` +
        `This is the <b>only time</b> it will be shown.\n\n` +
        `<code>${esc(gen.privateKey)}</code>\n\n` +
        `⚠️ This message will be deleted in 60 seconds.`,
      { parse_mode: 'HTML' },
    );
    setTimeout(async () => {
      try { await ctx.telegram.deleteMessage(ctx.chat!.id, keyMsg.message_id); } catch {}
    }, 60_000);

    // Send QR code + wallet info (persists)
    const qr = await generateQrBuffer(gen.address);
    const icon = type === 'evm' ? '💎' : '☀️';
    await ctx.replyWithPhoto(
      { source: qr },
      {
        caption:
          `✅ <b>Wallet Created!</b>\n\n` +
          `${icon} <b>${esc(wallet.label)}</b>\n` +
          `<code>${gen.address}</code>\n\n` +
          `Fund this wallet to start launching tokens.`,
        parse_mode: 'HTML',
        ...walletDetailKeyboard(wallet.id, true),
      },
    );
    return;
  }

  // w:import:evm / w:import:svm
  if (data === 'w:import:evm' || data === 'w:import:svm') {
    const type = data.endsWith('evm') ? 'evm' : 'svm';
    ctx.session._walletImportMode = type as 'evm' | 'svm';
    const format = type === 'evm' ? 'hex (0x...)' : 'base58';
    await cleanSend(
      ctx,
      `📥 <b>Import ${type === 'evm' ? 'EVM' : 'Solana'} Wallet</b>\n\n` +
        `Send your private key (${format} format):`,
    );
    return;
  }

  // w:detail:<id>
  if (data.startsWith('w:detail:')) {
    const walletId = data.slice(9);
    const wallet = await walletStore.getWallet(userId, walletId);
    if (!wallet) { await walletDashboard(ctx); return; }
    const { defaultWalletId } = await walletStore.getUserWallets(userId);
    const icon = wallet.type === 'evm' ? '💎' : '☀️';
    const def = wallet.id === defaultWalletId ? ' ⭐' : '';
    await cleanSend(
      ctx,
      `${icon} <b>${esc(wallet.label)}</b>${def}\n\n` +
        `<b>Address:</b> <code>${wallet.address}</code>\n` +
        `<b>Type:</b> ${wallet.type === 'evm' ? 'EVM' : 'Solana'}\n` +
        `<b>Created:</b> ${wallet.createdAt.split('T')[0]}`,
      walletDetailKeyboard(walletId, wallet.id === defaultWalletId),
    );
    return;
  }

  // w:balance:<id>
  if (data.startsWith('w:balance:')) {
    const walletId = data.slice(10);
    const wallet = await walletStore.getWallet(userId, walletId);
    if (!wallet) return;
    try {
      const result = await getBalance(wallet.address, wallet.type);
      const { defaultWalletId } = await walletStore.getUserWallets(userId);
      const icon = wallet.type === 'evm' ? '💎' : '☀️';
      const def = wallet.id === defaultWalletId ? ' ⭐' : '';
      await cleanSend(
        ctx,
        `${icon} <b>${esc(wallet.label)}</b>${def}\n\n` +
          `<b>Address:</b> <code>${wallet.address}</code>\n` +
          `<b>Type:</b> ${wallet.type === 'evm' ? 'EVM' : 'Solana'}\n\n` +
          `💰 <b>Balance:</b> ${result.balance} (${result.chain})`,
        walletDetailKeyboard(walletId, wallet.id === defaultWalletId),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'RPC error';
      await cleanSend(ctx, `❌ Failed to fetch balance: ${esc(msg)}`);
    }
    return;
  }

  // w:qr:<id>
  if (data.startsWith('w:qr:')) {
    const walletId = data.slice(5);
    const wallet = await walletStore.getWallet(userId, walletId);
    if (!wallet) return;
    const qr = await generateQrBuffer(wallet.address);
    await ctx.replyWithPhoto(
      { source: qr },
      {
        caption: `📱 <b>${esc(wallet.label)}</b>\n<code>${wallet.address}</code>`,
        parse_mode: 'HTML',
      },
    );
    return;
  }

  // w:export:<id>
  if (data.startsWith('w:export:')) {
    const walletId = data.slice(9);
    const wallet = await walletStore.getWallet(userId, walletId);
    if (!wallet) return;
    const key = await walletStore.decryptKey(userId, wallet.id);
    const keyMsg = await ctx.reply(
      `🔑 <b>Private Key — ${esc(wallet.label)}</b>\n\n` +
        `<code>${esc(key)}</code>\n\n` +
        `⚠️ This message will be deleted in 30 seconds.`,
      { parse_mode: 'HTML' },
    );
    setTimeout(async () => {
      try { await ctx.telegram.deleteMessage(ctx.chat!.id, keyMsg.message_id); } catch {}
    }, 30_000);
    return;
  }

  // w:default:<id>
  if (data.startsWith('w:default:')) {
    const walletId = data.slice(10);
    await walletStore.setDefault(userId, walletId);
    // Re-render detail view
    await handleWalletCallbacks(ctx, `w:detail:${walletId}`);
    return;
  }

  // w:delete:<id>
  if (data.startsWith('w:delete:')) {
    const walletId = data.slice(9);
    const wallet = await walletStore.getWallet(userId, walletId);
    if (!wallet) return;
    await cleanSend(
      ctx,
      `🗑️ Delete <b>${esc(wallet.label)}</b>?\n\n<code>${wallet.address}</code>\n\nThis cannot be undone.`,
      walletDeleteConfirmKeyboard(walletId),
    );
    return;
  }

  // w:confirmdelete:<id>
  if (data.startsWith('w:confirmdelete:')) {
    const walletId = data.slice(16);
    await walletStore.removeWallet(userId, walletId);
    await cleanSend(ctx, '✅ Wallet deleted.', mainMenuKeyboard());
    return;
  }
}

// ── Wallet import text handler ──

export async function handleWalletImportText(ctx: BotContext): Promise<boolean> {
  if (!ctx.session._walletImportMode) return false;

  const text = ctx.message && 'text' in ctx.message ? ctx.message.text?.trim() : undefined;
  if (!text) return false;

  const type = ctx.session._walletImportMode;
  ctx.session._walletImportMode = false;

  // Delete message containing private key
  await deleteUserMsg(ctx);

  try {
    const gen = type === 'evm' ? importEvmWallet(text) : importSolanaWallet(text);
    const userId = ctx.from!.id.toString();
    const wallet = await walletStore.addWallet(userId, type, gen.address, gen.privateKey);

    const icon = type === 'evm' ? '💎' : '☀️';
    await cleanSend(
      ctx,
      `✅ <b>Wallet Imported!</b>\n\n` +
        `${icon} <b>${esc(wallet.label)}</b>\n` +
        `<code>${gen.address}</code>`,
      mainMenuKeyboard(),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid key';
    await cleanSend(ctx, `❌ Import failed: ${esc(msg)}\n\nCheck your private key format.`, mainMenuKeyboard());
  }
  return true;
}

// ── /quote ──

export async function quoteCommand(ctx: BotContext) {
  const userId = ctx.from!.id.toString();
  const walletTypes = await walletStore.getUserWalletTypes(userId);
  ctx.session.launch = { chains: [] };
  await cleanSend(
    ctx,
    'Select chain(s) for the quote:',
    chainKeyboard([], walletTypes.size > 0 ? walletTypes : undefined),
  );
}

export async function handleQuoteChainCb(ctx: BotContext, data: string) {
  if (!ctx.session.launch) ctx.session.launch = { chains: [] };
  if (!ctx.session.launch.chains) ctx.session.launch.chains = [];

  if (data === 'chains:done') {
    const chains = ctx.session.launch.chains;
    if (chains.length === 0) return;
    await cleanSend(ctx, 'How much USD for the initial buy? (e.g. <b>10</b>)');
    ctx.session._quoteMode = true;
    return;
  }

  if (data.startsWith('chain:')) {
    const chainId = data.slice(6);
    const chains = ctx.session.launch.chains!;
    const idx = chains.indexOf(chainId);
    if (idx >= 0) chains.splice(idx, 1);
    else chains.push(chainId);
    ctx.session.launch.chains = chains;

    const userId = ctx.from!.id.toString();
    const walletTypes = await walletStore.getUserWalletTypes(userId);
    try {
      await ctx.editMessageReplyMarkup(
        chainKeyboard(chains, walletTypes.size > 0 ? walletTypes : undefined).reply_markup,
      );
    } catch {}
  }
}

export async function handleQuoteAmount(ctx: BotContext): Promise<boolean> {
  if (!ctx.session._quoteMode) return false;
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : undefined;
  if (!text) return false;

  const amount = parseFloat(text.replace(/[$,]/g, ''));
  if (isNaN(amount) || amount < 0) {
    await cleanSend(ctx, 'Invalid amount. Enter a number in USD:');
    return true;
  }

  const chains = ctx.session.launch?.chains ?? [];
  await cleanSend(ctx, '⏳ Fetching quote...');

  try {
    const quote = await printr.quote({
      chains,
      initial_buy: { spend_usd: amount },
      graduation_threshold_per_chain_usd: 69000,
    });
    await cleanSend(ctx, formatQuote(quote), mainMenuKeyboard());
  } catch (err) {
    const msg = err instanceof PrintrApiError ? err.detail : 'Failed to fetch quote';
    await cleanSend(ctx, `❌ Quote failed: ${esc(msg)}`, mainMenuKeyboard());
  }

  ctx.session._quoteMode = false;
  ctx.session.launch = {};
  return true;
}

// ── /mytokens ──

export async function myTokensCommand(ctx: BotContext) {
  const userId = ctx.from!.id.toString();
  const tokens = await tokenStore.list(userId, 20);

  if (tokens.length === 0) {
    await cleanSend(
      ctx,
      '<b>📜 Your Tokens</b>\n\n' +
        'No launches yet. Tap <b>⚡ Quick Launch</b> or <b>🚀 Launch Token</b> to ship your first.',
      mainMenuKeyboard(),
    );
    return;
  }

  const appUrl = config.printrBaseUrl.replace('api-preview', 'app');
  const lines: string[] = [`<b>📜 Your Tokens</b> (${tokens.length})`, ''];
  for (const t of tokens) {
    const date = t.createdAt.toISOString().split('T')[0];
    const chainLabels = t.chains.map((c) => {
      if (c.startsWith('solana:')) return '☀️';
      if (c.startsWith('eip155:8453')) return '🔵';
      if (c.startsWith('eip155:1')) return '💎';
      if (c.startsWith('eip155:42161')) return '🔹';
      return '🔗';
    }).join(' ');
    const symbol = t.symbol ? `$${esc(t.symbol)}` : '?';
    const name = t.name ? esc(t.name) : '(unnamed)';
    lines.push(
      `🪙 <b>${symbol}</b> · ${name}  ${chainLabels}\n` +
        `   ${date} · <a href="${appUrl}/trade/${t.tokenId}">view on Printr</a>`,
    );
  }

  // Build a Trade-button keyboard: one row per token (only Solana tokens
  // with a stored swap context can be sold from inside the bot).
  const Markup = await import('telegraf').then((m) => m.Markup);
  const { shortTokenId } = await import('./keyboards.js');
  const tradeRows = tokens
    .filter((t) => t.swapContext && t.chains.some((c) => c.startsWith('solana:')))
    .slice(0, 5) // cap rows so the keyboard stays manageable
    .map((t) => [
      Markup.button.callback(
        `💱 Trade ${t.symbol ? '$' + t.symbol : t.tokenId.slice(0, 6)}`,
        `trade:open:${shortTokenId(t.tokenId)}`,
      ),
    ]);
  const kb = Markup.inlineKeyboard([
    ...tradeRows,
    [Markup.button.callback('🏠 Main menu', 'action:start')],
  ]);

  await cleanSend(ctx, lines.join('\n\n'), kb);
}

// ── /status ──

export async function statusCommand(ctx: BotContext) {
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const parts = text.split(/\s+/);
  const tokenId = parts[1];

  if (!tokenId) {
    await cleanSend(
      ctx,
      '📊 <b>Check Status</b>\n\nSend the token ID:\n\n<code>/status &lt;token_id&gt;</code>',
    );
    return;
  }

  await deleteUserMsg(ctx);
  await cleanSend(ctx, '⏳ Checking status...');

  try {
    const deployments = await printr.getDeployments(tokenId);
    await cleanSend(ctx, formatDeployments(deployments), mainMenuKeyboard());
  } catch (err) {
    const msg = err instanceof PrintrApiError ? err.detail : 'Failed to fetch status';
    await cleanSend(ctx, `❌ ${esc(msg)}`, mainMenuKeyboard());
  }
}
