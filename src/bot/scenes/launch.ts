import { Scenes } from 'telegraf';
import type { BotContext } from '../context.js';
import { printr, PrintrApiError } from '../../printr/client.js';
import { getChain } from '../../printr/chains.js';
import { signAndSubmitEvm } from '../../printr/signer.js';
import { signAndSubmitSvm } from '../../printr/signer.js';
import type { SvmPayload, EvmSubmitResult } from '../../printr/signer.js';
import { walletStore } from '../../store/wallets.js';
import { tokenStore } from '../../store/tokens.js';
import {
  chainKeyboard,
  graduationKeyboard,
  confirmKeyboard,
  mainMenuKeyboard,
  walletRequiredKeyboard,
  advancedToggleKeyboard,
  maxSupplyKeyboard,
  supplyRatioKeyboard,
  bondingFeeKeyboard,
  ammFeeKeyboard,
  feeSinkKeyboard,
  socialsPromptKeyboard,
  justMenu,
  withMenu,
} from '../keyboards.js';
import type { FeeSink, MaxTelecoinSupply } from '../../printr/types.js';
import { parseSocials, cleanExternalLinks, SOCIALS_PROMPT } from '../socials.js';
import { appendBlastrTag } from '../signature.js';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { logger } from '../../logger.js';

const DEFAULTS = {
  maxSupply: '1_billion' as MaxTelecoinSupply,
  supplyOnCurveBps: 7000,
  bondingCurveDevFeeBps: 100,
  ammDevFeeBps: 50,
  feeSink: 'dev' as FeeSink,
};
import {
  formatQuote,
  formatLaunchSummary,
  formatTokenCreated,
  formatTxResult,
  esc,
} from '../format.js';
import { cleanSend, deleteUserMsg } from '../helpers.js';
import { config } from '../../config.js';
import {
  startCommand,
  helpCommand,
  quoteCommand,
  statusCommand,
  walletDashboard,
} from '../commands.js';
import type { EvmPayload } from '../../printr/types.js';

function getText(ctx: BotContext): string | undefined {
  return ctx.message && 'text' in ctx.message ? ctx.message.text : undefined;
}

function getCbData(ctx: BotContext): string | undefined {
  return ctx.callbackQuery && 'data' in ctx.callbackQuery
    ? ctx.callbackQuery.data
    : undefined;
}

function skipButton() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '⏭ Skip', callback_data: 'skip' }],
        [{ text: '🏠 Menu', callback_data: 'action:start' }],
      ],
    },
  };
}

// ── Step 0: Receive name, ask symbol ──
async function receiveName(ctx: BotContext) {
  const text = getText(ctx);
  if (!text) return;
  if (text.length < 1 || text.length > 32) {
    await cleanSend(ctx, 'Name must be 1-32 characters. Try again:', justMenu());
    return;
  }
  ctx.session.launch.name = text;
  await cleanSend(ctx, 'What ticker symbol? <i>(1-10 chars, e.g. BLASTR)</i>', justMenu());
  return ctx.wizard.next();
}

// ── Step 1: Receive symbol, ask description ──
async function receiveSymbol(ctx: BotContext) {
  const text = getText(ctx);
  if (!text) return;
  if (text.length < 1 || text.length > 10) {
    await cleanSend(ctx, 'Symbol must be 1-10 characters. Try again:', justMenu());
    return;
  }
  ctx.session.launch.symbol = text.toUpperCase();
  await cleanSend(
    ctx,
    'Token description? <i>(max 500 chars)</i>\n\nTap <b>Skip</b> to leave blank.',
    skipButton(),
  );
  return ctx.wizard.next();
}

// ── Step 2: Receive description, ask for socials ──
async function receiveDescription(ctx: BotContext) {
  const data = getCbData(ctx);
  const text = getText(ctx);
  if (data === 'skip') {
    await ctx.answerCbQuery().catch(() => {});
    ctx.session.launch.description = '';
  } else if (text) {
    ctx.session.launch.description = text.slice(0, 500);
  } else {
    return;
  }
  await cleanSend(ctx, SOCIALS_PROMPT, withMenu(socialsPromptKeyboard()));
  return ctx.wizard.next();
}

// ── Step 2b: Receive socials, ask for image ──
async function receiveSocials(ctx: BotContext) {
  const data = getCbData(ctx);
  const text = getText(ctx);
  if (data === 'skip') {
    await ctx.answerCbQuery().catch(() => {});
    ctx.session.launch.externalLinks = {};
  } else if (text) {
    ctx.session.launch.externalLinks = parseSocials(text);
  } else {
    return;
  }
  await cleanSend(
    ctx,
    '🖼 <b>Token Image</b>\n\nSend a photo for your token logo <i>(JPEG or PNG, max 4MB)</i>.\n\nTap <b>Skip</b> to launch without an image.',
    skipButton(),
  );
  return ctx.wizard.next();
}

// ── Step 3: Receive image, show chain keyboard ──
async function receiveImage(ctx: BotContext) {
  const data = getCbData(ctx);
  if (data === 'skip') {
    await ctx.answerCbQuery().catch(() => {});
    ctx.session.launch.image = '';
  } else if (ctx.message && 'photo' in ctx.message && ctx.message.photo.length > 0) {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    try {
      const fileLink = await ctx.telegram.getFileLink(photo.file_id);
      const res = await fetch(fileLink.href);
      const buffer = Buffer.from(await res.arrayBuffer());
      ctx.session.launch.image = buffer.toString('base64');
      await deleteUserMsg(ctx);
    } catch {
      await cleanSend(ctx, '⚠️ Failed to process image. Try again or tap <b>Skip</b>.', skipButton());
      return;
    }
  } else if (ctx.message && 'document' in ctx.message && ctx.message.document?.mime_type?.startsWith('image/')) {
    try {
      const fileLink = await ctx.telegram.getFileLink(ctx.message.document.file_id);
      const res = await fetch(fileLink.href);
      const buffer = Buffer.from(await res.arrayBuffer());
      ctx.session.launch.image = buffer.toString('base64');
      await deleteUserMsg(ctx);
    } catch {
      await cleanSend(ctx, '⚠️ Failed to process image. Try again or tap <b>Skip</b>.', skipButton());
      return;
    }
  } else {
    return;
  }

  // Chain gating: only show chains matching user's wallet types
  const userId = ctx.from!.id.toString();
  const walletTypes = await walletStore.getUserWalletTypes(userId);
  const selected = ctx.session.launch.chains ?? [];
  await cleanSend(ctx, 'Select the chain(s) to deploy on:', withMenu(chainKeyboard(selected, walletTypes)));
  return ctx.wizard.next();
}

// ── Step 4: Chain selection ──
async function handleChainSelection(ctx: BotContext) {
  const data = getCbData(ctx);
  if (!data) return;
  await ctx.answerCbQuery().catch(() => {});

  if (data === 'chains:done') {
    const chains = ctx.session.launch.chains ?? [];
    if (chains.length === 0) return;
    await cleanSend(ctx, 'How much SOL for the initial buy?\n\n<i>Enter 0 to skip, or an amount like 0.5</i>', justMenu());
    return ctx.wizard.next();
  }

  if (data.startsWith('chain:')) {
    const chainId = data.slice(6);
    const chains = ctx.session.launch.chains ?? [];
    const idx = chains.indexOf(chainId);
    if (idx >= 0) chains.splice(idx, 1);
    else chains.push(chainId);
    ctx.session.launch.chains = chains;

    const userId = ctx.from!.id.toString();
    const walletTypes = await walletStore.getUserWalletTypes(userId);
    try {
      await ctx.editMessageReplyMarkup(chainKeyboard(chains, walletTypes).reply_markup);
    } catch {}
  }
}

// ── Step 5: Receive initial buy ──
async function receiveInitialBuy(ctx: BotContext) {
  const text = getText(ctx);
  if (!text) return;
  const amount = parseFloat(text.replace(/[$,]/g, ''));
  if (isNaN(amount) || amount < 0) {
    await cleanSend(ctx, 'Invalid amount. Enter a number in SOL <i>(e.g. 0.5, or 0 to skip)</i>:', justMenu());
    return;
  }
  ctx.session.launch.initialBuySol = amount;
  await cleanSend(ctx, 'Graduation threshold per chain:', withMenu(graduationKeyboard()));
  return ctx.wizard.next();
}

// ── Step 6: Receive graduation, ask about advanced mode ──
async function receiveGraduation(ctx: BotContext) {
  const data = getCbData(ctx);
  if (!data || !data.startsWith('grad:')) return;
  await ctx.answerCbQuery().catch(() => {});

  const threshold = parseInt(data.slice(5), 10);
  ctx.session.launch.graduationThreshold = threshold;

  await cleanSend(
    ctx,
    '🛠 <b>Launch mode</b>\n\n' +
      '<b>Quick:</b> use sensible defaults (1B supply, 70% curve, 1% bonding fee, 0.5% AMM fee, fees → creator)\n\n' +
      '<b>Advanced:</b> customize supply, curve ratio, creator fees, and fee sink.',
    withMenu(advancedToggleKeyboard()),
  );
  return ctx.wizard.next();
}

// ── Step 7: Advanced toggle — skip to quote or walk through advanced steps ──
async function handleAdvancedToggle(ctx: BotContext) {
  const data = getCbData(ctx);
  if (!data) return;
  await ctx.answerCbQuery().catch(() => {});

  if (data === 'adv:skip') {
    const l = ctx.session.launch;
    l.maxSupply = DEFAULTS.maxSupply;
    l.supplyOnCurveBps = DEFAULTS.supplyOnCurveBps;
    l.bondingCurveDevFeeBps = DEFAULTS.bondingCurveDevFeeBps;
    l.ammDevFeeBps = DEFAULTS.ammDevFeeBps;
    l.feeSink = DEFAULTS.feeSink;
    return showQuoteAndConfirm(ctx);
  }

  if (data === 'adv:open') {
    await cleanSend(ctx, '🪙 <b>Max supply</b>\n\nTotal token supply at graduation.', withMenu(maxSupplyKeyboard()));
    return ctx.wizard.next();
  }
}

// ── Step 8: Max supply ──
async function handleMaxSupply(ctx: BotContext) {
  const data = getCbData(ctx);
  if (!data || !data.startsWith('supply:')) return;
  await ctx.answerCbQuery().catch(() => {});
  ctx.session.launch.maxSupply = data.slice(7) as MaxTelecoinSupply;
  await cleanSend(
    ctx,
    '📈 <b>Bonding curve supply ratio</b>\n\n' +
      'Percent of supply sold on the bonding curve. The rest is deposited into the AMM at graduation.',
    withMenu(supplyRatioKeyboard()),
  );
  return ctx.wizard.next();
}

// ── Step 9: Supply on curve ratio ──
async function handleSupplyRatio(ctx: BotContext) {
  const data = getCbData(ctx);
  if (!data || !data.startsWith('ratio:')) return;
  await ctx.answerCbQuery().catch(() => {});
  ctx.session.launch.supplyOnCurveBps = parseInt(data.slice(6), 10);
  await cleanSend(
    ctx,
    '💵 <b>Bonding curve dev fee</b>\n\nYour cut of trading fees while on the curve (0-1.5%).',
    withMenu(bondingFeeKeyboard()),
  );
  return ctx.wizard.next();
}

// ── Step 10: Bonding curve dev fee ──
async function handleBondingFee(ctx: BotContext) {
  const data = getCbData(ctx);
  if (!data || !data.startsWith('bond:')) return;
  await ctx.answerCbQuery().catch(() => {});
  ctx.session.launch.bondingCurveDevFeeBps = parseInt(data.slice(5), 10);
  await cleanSend(
    ctx,
    '💵 <b>AMM dev fee</b>\n\nYour cut of trading fees after graduation (0-0.8%).',
    withMenu(ammFeeKeyboard()),
  );
  return ctx.wizard.next();
}

// ── Step 11: AMM dev fee ──
async function handleAmmFee(ctx: BotContext) {
  const data = getCbData(ctx);
  if (!data || !data.startsWith('amm:')) return;
  await ctx.answerCbQuery().catch(() => {});
  ctx.session.launch.ammDevFeeBps = parseInt(data.slice(4), 10);
  await cleanSend(
    ctx,
    '🎯 <b>Fee sink</b>\n\nWhere collected fees route.',
    withMenu(feeSinkKeyboard()),
  );
  return ctx.wizard.next();
}

// ── Step 12: Fee sink → show quote ──
async function handleFeeSink(ctx: BotContext) {
  const data = getCbData(ctx);
  if (!data || !data.startsWith('sink:')) return;
  await ctx.answerCbQuery().catch(() => {});
  ctx.session.launch.feeSink = data.slice(5) as FeeSink;
  return showQuoteAndConfirm(ctx);
}

// ── Shared: quote + confirm ──
async function showQuoteAndConfirm(ctx: BotContext) {
  const launch = ctx.session.launch;

  const initialBuy = (launch.initialBuySol ?? 0) > 0
    ? { spend_native: Math.floor(launch.initialBuySol! * LAMPORTS_PER_SOL).toString() }
    : { spend_native: '100000' };

  const quoteBody = {
    chains: launch.chains!,
    initial_buy: initialBuy,
    graduation_threshold_per_chain_usd: launch.graduationThreshold!,
    custom_fees: {
      bonding_curve_dev_fee_bps: launch.bondingCurveDevFeeBps!,
      amm_dev_fee_bps: launch.ammDevFeeBps!,
    },
    fee_sink: launch.feeSink!,
    telecoin_supply_on_curve_ratio_bps: launch.supplyOnCurveBps!,
    max_telecoin_supply: launch.maxSupply!,
  };

  const hasSolana = launch.chains!.some((c) => c.startsWith('solana:'));
  const hasEvm = launch.chains!.some((c) => !c.startsWith('solana:'));
  const feeLines: string[] = [];
  if (hasSolana && config.blastrFeeRecipientSvm && config.blastrFeeSol > 0) {
    feeLines.push(`${config.blastrFeeSol} SOL`);
  }
  if (hasEvm && config.blastrFeeRecipientEvm && BigInt(config.blastrFeeWei) > 0n) {
    const eth = Number(BigInt(config.blastrFeeWei)) / 1e18;
    feeLines.push(`${eth} native (EVM)`);
  }
  const blastrFeeLabel = feeLines.length > 0 ? feeLines.join(' + ') : undefined;

  const summary = formatLaunchSummary({
    name: launch.name!,
    symbol: launch.symbol!,
    description: appendBlastrTag(launch.description),
    chains: launch.chains!,
    initialBuySol: launch.initialBuySol!,
    graduationThreshold: launch.graduationThreshold!,
    hasImage: !!launch.image,
    maxSupply: launch.maxSupply,
    supplyOnCurveBps: launch.supplyOnCurveBps,
    bondingCurveDevFeeBps: launch.bondingCurveDevFeeBps,
    ammDevFeeBps: launch.ammDevFeeBps,
    feeSink: launch.feeSink,
    externalLinks: cleanExternalLinks(launch.externalLinks),
    blastrFeeLabel,
  });

  try {
    const quote = await printr.quote(quoteBody);
    await cleanSend(ctx, `${summary}\n\n${formatQuote(quote)}\n\n<b>Confirm launch?</b>`, confirmKeyboard());
  } catch (err) {
    const msg = err instanceof PrintrApiError ? `API: ${err.detail}` : 'Could not fetch quote';
    await cleanSend(ctx, `${summary}\n\n⚠️ ${esc(msg)}\n\n<b>Launch anyway?</b>`, confirmKeyboard());
  }
  return ctx.wizard.selectStep(14);
}

// ── Step 7: Confirm and create ──
async function handleConfirm(ctx: BotContext) {
  const data = getCbData(ctx);
  if (!data) return;
  await ctx.answerCbQuery().catch(() => {});

  if (data === 'confirm:no') {
    await cleanSend(ctx, 'Launch cancelled.', mainMenuKeyboard());
    return ctx.scene.leave();
  }
  if (data !== 'confirm:yes') return;

  const userId = ctx.from!.id.toString();
  const launch = ctx.session.launch;
  const chains = launch.chains!;
  const userWallets = await walletStore.getUserWallets(userId);
  const evmWallet = userWallets.wallets.find((w) => w.type === 'evm');
  const svmWallet = userWallets.wallets.find((w) => w.type === 'svm');
  const defaultWallet = await walletStore.getDefaultWallet(userId);

  // Build creator_accounts using the right wallet for each chain
  const creatorAccounts = chains.map((chainCaip2) => {
    const chain = getChain(chainCaip2);
    if (chain?.type === 'svm' && svmWallet) return `${chainCaip2}:${svmWallet.address}`;
    if (chain?.type === 'evm' && evmWallet) return `${chainCaip2}:${evmWallet.address}`;
    return `${chainCaip2}:${defaultWallet?.address ?? ''}`;
  });

  const initialBuy = launch.initialBuySol! > 0
    ? { spend_native: Math.floor(launch.initialBuySol! * LAMPORTS_PER_SOL).toString() }
    : { spend_native: '100000' };

  await cleanSend(ctx, '⏳ Creating token on Printr...');

  try {
    const result = await printr.createToken({
      creator_accounts: creatorAccounts,
      name: launch.name!,
      symbol: launch.symbol!,
      description: appendBlastrTag(launch.description),
      image: launch.image || undefined,
      chains,
      initial_buy: initialBuy,
      graduation_threshold_per_chain_usd: launch.graduationThreshold!,
      external_links: cleanExternalLinks(launch.externalLinks),
      custom_fees: {
        bonding_curve_dev_fee_bps: launch.bondingCurveDevFeeBps!,
        amm_dev_fee_bps: launch.ammDevFeeBps!,
      },
      fee_sink: launch.feeSink!,
      telecoin_supply_on_curve_ratio_bps: launch.supplyOnCurveBps!,
      max_telecoin_supply: launch.maxSupply!,
    });

    const appUrl = config.printrBaseUrl.replace('api-preview', 'app');
    const tokenMsg = formatTokenCreated(result.token_id, appUrl);
    const payload = result.payload;

    // Best-effort record so /mytokens can list it later.
    void tokenStore
      .record(userId, result.token_id, launch.name!, launch.symbol!, chains)
      .catch((err) => logger.warn({ err, userId, tokenId: result.token_id }, 'tokenStore.record failed'));

    logger.debug({ userId, payloadKeys: Object.keys(payload) }, 'launch payload');

    // Determine chain types in this launch
    const hasSolana = chains.some((c) => c.startsWith('solana:'));
    const hasEvm = chains.some((c) => !c.startsWith('solana:'));

    // Auto-sign with the matching wallet
    let signed = false;

    if (hasSolana && svmWallet && (payload as unknown as SvmPayload).ixs) {
      await cleanSend(ctx, `${tokenMsg}\n\n⏳ Signing Solana transaction...`);
      try {
        const key = await walletStore.decryptKey(userId, svmWallet.id);
        const svmFee =
          config.blastrFeeRecipientSvm && config.blastrFeeSol > 0
            ? {
                recipient: config.blastrFeeRecipientSvm,
                lamports: Math.round(config.blastrFeeSol * LAMPORTS_PER_SOL),
              }
            : undefined;
        const svmResult = await signAndSubmitSvm(payload as unknown as SvmPayload, key, undefined, svmFee);
        await cleanSend(
          ctx,
          `${tokenMsg}\n\n<b>📡 Transaction Submitted</b>\n` +
            `<b>Signature:</b> <code>${svmResult.signature}</code>\n` +
            `<b>Status:</b> ${svmResult.confirmation_status}`,
          mainMenuKeyboard(),
        );
        signed = true;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        logger.error({ err, userId, chain: 'svm' }, 'launch sign failed');
        await cleanSend(ctx, `${tokenMsg}\n\n❌ Solana signing failed: ${esc(errMsg)}`, mainMenuKeyboard());
        signed = true; // Don't show the generic message
      }
    }

    if (hasEvm && evmWallet && (payload as unknown as EvmPayload).calldata) {
      await cleanSend(ctx, `${tokenMsg}\n\n⏳ Signing EVM transaction...`);
      try {
        const key = await walletStore.decryptKey(userId, evmWallet.id);
        const evmFee =
          config.blastrFeeRecipientEvm && BigInt(config.blastrFeeWei) > 0n
            ? { recipient: config.blastrFeeRecipientEvm, wei: config.blastrFeeWei }
            : undefined;
        const evmResult = await signAndSubmitEvm(payload as unknown as EvmPayload, key, undefined, evmFee);
        await cleanSend(
          ctx,
          `${tokenMsg}\n\n${formatTxResult(evmResult.tx_hash, evmResult.tx_status)}`,
          mainMenuKeyboard(),
        );
        signed = true;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        logger.error({ err, userId, chain: 'evm' }, 'launch sign failed');
        await cleanSend(ctx, `${tokenMsg}\n\n❌ EVM signing failed: ${esc(errMsg)}`, mainMenuKeyboard());
        signed = true;
      }
    }

    if (!signed) {
      await cleanSend(
        ctx,
        `${tokenMsg}\n\n⚠️ Could not auto-sign. Check your wallet has the correct type for the selected chain.`,
        mainMenuKeyboard(),
      );
    }
  } catch (err) {
    const detail = err instanceof PrintrApiError ? err.detail : err instanceof Error ? err.message : '';
    if (/temporarily reserved/i.test(detail)) {
      const ticker = detail.match(/ticker "([^"]+)"/)?.[1] ?? launch.symbol;
      await cleanSend(
        ctx,
        `🛡 <b>Anti-Vamp Protection</b>\n\n` +
          `The ticker <b>${esc(ticker!)}</b> is reserved by another token launched in the last 48 hours.\n\n` +
          `Printr locks tickers and images for 48h after launch to protect creators from copycats.\n\n` +
          `Try again with a different ticker.`,
        mainMenuKeyboard(),
      );
    } else {
      await cleanSend(ctx, `❌ Launch failed: ${esc(detail || 'Unknown error')}`, mainMenuKeyboard());
    }
  }
  return ctx.scene.leave();
}

// ── Build the wizard scene ──

export const launchScene = new Scenes.WizardScene<BotContext>(
  'launch',
  receiveName,         // 0
  receiveSymbol,       // 1
  receiveDescription,  // 2
  receiveSocials,      // 3
  receiveImage,        // 4
  handleChainSelection,// 5
  receiveInitialBuy,   // 6
  receiveGraduation,   // 7
  handleAdvancedToggle,// 8
  handleMaxSupply,     // 9
  handleSupplyRatio,   // 10
  handleBondingFee,    // 11
  handleAmmFee,        // 12
  handleFeeSink,       // 13
  handleConfirm,       // 14
);

// Enter handler
launchScene.enter(async (ctx) => {
  ctx.session.launch = { chains: [] };
  await cleanSend(
    ctx,
    '🚀 <b>Launch a new token</b>\n\nWhat should your token be called? <i>(1-32 characters)</i>',
  );
});

// Allow commands/buttons to break out of wizard
launchScene.command('cancel', async (ctx) => {
  await cleanSend(ctx, 'Launch cancelled.', mainMenuKeyboard());
  return ctx.scene.leave();
});
launchScene.command('start', async (ctx) => { await ctx.scene.leave(); return startCommand(ctx); });
launchScene.command('wallet', async (ctx) => { await ctx.scene.leave(); return walletDashboard(ctx); });
launchScene.command('help', async (ctx) => { await ctx.scene.leave(); return helpCommand(ctx); });
launchScene.command('quote', async (ctx) => { await ctx.scene.leave(); return quoteCommand(ctx); });
launchScene.command('status', async (ctx) => { await ctx.scene.leave(); return statusCommand(ctx); });

launchScene.action('action:wallet', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); await ctx.scene.leave(); return walletDashboard(ctx); });
launchScene.action('action:start', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); await ctx.scene.leave(); return startCommand(ctx); });
launchScene.action('action:launch', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); });
launchScene.action('action:help', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); await ctx.scene.leave(); return helpCommand(ctx); });
launchScene.action('action:quote', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); await ctx.scene.leave(); return quoteCommand(ctx); });
