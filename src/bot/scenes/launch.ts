import { Scenes } from 'telegraf';
import type { BotContext } from '../context.js';
import { printr, PrintrApiError } from '../../printr/client.js';
import { getChain } from '../../printr/chains.js';
import { signAndSubmitEvm } from '../../printr/signer.js';
import { signAndSubmitSvm } from '../../printr/signer.js';
import type { SvmPayload, EvmSubmitResult } from '../../printr/signer.js';
import { walletStore } from '../../store/wallets.js';
import { tokenStore } from '../../store/tokens.js';
import { presetStore } from '../../store/presets.js';
import { buildAutoStakeIxs, planAutoStake, renderAutoStakeStatus, type AutoStakePlan } from '../../printr/stake.js';
import { extractSwapContext, normalizeMint } from '../../printr/sell.js';
import { Connection, PublicKey, type TransactionInstruction } from '@solana/web3.js';
import {
  chainKeyboard,
  graduationKeyboard,
  confirmKeyboard,
  mainMenuKeyboard,
  walletRequiredKeyboard,
  postLaunchKeyboard,
  lockPeriodPickerKeyboard,
  advancedToggleKeyboard,
  maxSupplyKeyboard,
  supplyRatioKeyboard,
  bondingFeeKeyboard,
  ammFeeKeyboard,
  feeSinkKeyboard,
  socialsPromptKeyboard,
  justNav,
  withNav,
} from '../keyboards.js';
import type { FeeSink, MaxTelecoinSupply } from '../../printr/types.js';
import { parseSocials, cleanExternalLinks, SOCIALS_PROMPT } from '../socials.js';
import { appendBlastrTag } from '../signature.js';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { logger } from '../../logger.js';
import { publishLaunch } from '../launchFeed.js';

const DEFAULTS = {
  maxSupply: '1_billion' as MaxTelecoinSupply,
  supplyOnCurveBps: 7000,
  bondingCurveDevFeeBps: 100,
  ammDevFeeBps: 50,
  // stake_pool by default so Quick path through /launch gets auto-stake too.
  // Devs who explicitly want fees-to-creator pick Advanced and select 'dev'.
  feeSink: 'stake_pool' as FeeSink,
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

function skipButton(showBack = true) {
  const navButtons = showBack
    ? [
        { text: '← Back', callback_data: 'wiz:back' },
        { text: '🏠 Menu', callback_data: 'action:start' },
      ]
    : [{ text: '🏠 Menu', callback_data: 'action:start' }];
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '⏭ Skip', callback_data: 'skip' }],
        navButtons,
      ],
    },
  };
}

// ── Step prompts ──
// Each prompt is a standalone fn so the back handler can re-call it after
// decrementing wizard.cursor. Mapping: STEP_PROMPTS[N] re-prompts step N.
// Step 0 has no back. Step 14 (confirm) has its own Cancel — no back.

async function promptName(ctx: BotContext) {
  await cleanSend(
    ctx,
    '🚀 <b>Launch a new token</b>\n\nWhat should your token be called? <i>(1-32 characters)</i>',
    justNav(false),
  );
}
async function promptSymbol(ctx: BotContext) {
  await cleanSend(ctx, 'What ticker symbol? <i>(1-10 chars, e.g. BLASTR)</i>', justNav(true));
}
async function promptDescription(ctx: BotContext) {
  await cleanSend(
    ctx,
    'Token description? <i>(max 500 chars)</i>\n\nTap <b>Skip</b> to leave blank.',
    skipButton(true),
  );
}
async function promptSocials(ctx: BotContext) {
  await cleanSend(ctx, SOCIALS_PROMPT, withNav(socialsPromptKeyboard(), true));
}
async function promptImage(ctx: BotContext) {
  await cleanSend(
    ctx,
    '🖼 <b>Token Image</b>\n\nSend a photo for your token logo <i>(JPEG or PNG, max 4MB)</i>.\n\nTap <b>Skip</b> to launch without an image.',
    skipButton(true),
  );
}
async function promptChains(ctx: BotContext) {
  const userId = ctx.from!.id.toString();
  const walletTypes = await walletStore.getUserWalletTypes(userId);
  const selected = ctx.session.launch.chains ?? [];
  await cleanSend(ctx, 'Select the chain(s) to deploy on:', withNav(chainKeyboard(selected, walletTypes), true));
}
async function promptInitialBuy(ctx: BotContext) {
  await cleanSend(ctx, 'How much SOL for the initial buy?\n\n<i>Enter 0 to skip, or an amount like 0.5</i>', justNav(true));
}
async function promptGraduation(ctx: BotContext) {
  await cleanSend(ctx, 'Graduation threshold per chain:', withNav(graduationKeyboard(), true));
}
async function promptAdvancedToggle(ctx: BotContext) {
  await cleanSend(
    ctx,
    '🛠 <b>Launch mode</b>\n\n' +
      '<b>Quick:</b> use sensible defaults (1B supply, 70% curve, 1% bonding fee, 0.5% AMM fee, fees → creator)\n\n' +
      '<b>Advanced:</b> customize supply, curve ratio, creator fees, and fee sink.',
    withNav(advancedToggleKeyboard(), true),
  );
}
async function promptMaxSupply(ctx: BotContext) {
  await cleanSend(ctx, '🪙 <b>Max supply</b>\n\nTotal token supply at graduation.', withNav(maxSupplyKeyboard(), true));
}
async function promptSupplyRatio(ctx: BotContext) {
  await cleanSend(
    ctx,
    '📈 <b>Bonding curve supply ratio</b>\n\n' +
      'Percent of supply sold on the bonding curve. The rest is deposited into the AMM at graduation.',
    withNav(supplyRatioKeyboard(), true),
  );
}
async function promptBondingFee(ctx: BotContext) {
  await cleanSend(
    ctx,
    '💵 <b>Bonding curve dev fee</b>\n\nYour cut of trading fees while on the curve (0-1.5%).',
    withNav(bondingFeeKeyboard(), true),
  );
}
async function promptAmmFee(ctx: BotContext) {
  await cleanSend(
    ctx,
    '💵 <b>AMM dev fee</b>\n\nYour cut of trading fees after graduation (0-0.8%).',
    withNav(ammFeeKeyboard(), true),
  );
}
async function promptFeeSink(ctx: BotContext) {
  await cleanSend(
    ctx,
    '🎯 <b>Fee sink</b> — where trading fees go:\n\n' +
      '👤 <b>Creator</b> — fees stream to your wallet\n\n' +
      '💎 <b>Proof of Belief</b> — fees fund a stake pool; holders stake to earn a share. <b>Required for auto-stake.</b>\n\n' +
      '🔥 <b>Buyback &amp; burn</b> — fees auto-buy your token and burn it (deflationary)',
    withNav(feeSinkKeyboard(), true),
  );
}

// ── Step 0: Receive name, ask symbol ──
async function receiveName(ctx: BotContext) {
  const text = getText(ctx);
  if (!text) return;
  if (text.length < 1 || text.length > 32) {
    await cleanSend(ctx, 'Name must be 1-32 characters. Try again:', justNav(false));
    return;
  }
  ctx.session.launch.name = text;
  await promptSymbol(ctx);
  return ctx.wizard.next();
}

// ── Step 1: Receive symbol, ask description ──
async function receiveSymbol(ctx: BotContext) {
  const text = getText(ctx);
  if (!text) return;
  if (text.length < 1 || text.length > 10) {
    await cleanSend(ctx, 'Symbol must be 1-10 characters. Try again:', justNav(true));
    return;
  }
  ctx.session.launch.symbol = text.toUpperCase();
  await promptDescription(ctx);
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
  await promptSocials(ctx);
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
  await promptImage(ctx);
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
      await cleanSend(ctx, '⚠️ Failed to process image. Try again or tap <b>Skip</b>.', skipButton(true));
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
      await cleanSend(ctx, '⚠️ Failed to process image. Try again or tap <b>Skip</b>.', skipButton(true));
      return;
    }
  } else {
    return;
  }

  await promptChains(ctx);
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
    await promptInitialBuy(ctx);
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
    await cleanSend(ctx, 'Invalid amount. Enter a number in SOL <i>(e.g. 0.5, or 0 to skip)</i>:', justNav(true));
    return;
  }
  ctx.session.launch.initialBuySol = amount;
  await promptGraduation(ctx);
  return ctx.wizard.next();
}

// ── Step 6: Receive graduation, ask about advanced mode ──
async function receiveGraduation(ctx: BotContext) {
  const data = getCbData(ctx);
  if (!data || !data.startsWith('grad:')) return;
  await ctx.answerCbQuery().catch(() => {});

  const threshold = parseInt(data.slice(5), 10);
  ctx.session.launch.graduationThreshold = threshold;

  await promptAdvancedToggle(ctx);
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
    await promptMaxSupply(ctx);
    return ctx.wizard.next();
  }
}

// ── Step 8: Max supply ──
async function handleMaxSupply(ctx: BotContext) {
  const data = getCbData(ctx);
  if (!data || !data.startsWith('supply:')) return;
  await ctx.answerCbQuery().catch(() => {});
  ctx.session.launch.maxSupply = data.slice(7) as MaxTelecoinSupply;
  await promptSupplyRatio(ctx);
  return ctx.wizard.next();
}

// ── Step 9: Supply on curve ratio ──
async function handleSupplyRatio(ctx: BotContext) {
  const data = getCbData(ctx);
  if (!data || !data.startsWith('ratio:')) return;
  await ctx.answerCbQuery().catch(() => {});
  ctx.session.launch.supplyOnCurveBps = parseInt(data.slice(6), 10);
  await promptBondingFee(ctx);
  return ctx.wizard.next();
}

// ── Step 10: Bonding curve dev fee ──
async function handleBondingFee(ctx: BotContext) {
  const data = getCbData(ctx);
  if (!data || !data.startsWith('bond:')) return;
  await ctx.answerCbQuery().catch(() => {});
  ctx.session.launch.bondingCurveDevFeeBps = parseInt(data.slice(5), 10);
  await promptAmmFee(ctx);
  return ctx.wizard.next();
}

// ── Step 11: AMM dev fee ──
async function handleAmmFee(ctx: BotContext) {
  const data = getCbData(ctx);
  if (!data || !data.startsWith('amm:')) return;
  await ctx.answerCbQuery().catch(() => {});
  ctx.session.launch.ammDevFeeBps = parseInt(data.slice(4), 10);
  await promptFeeSink(ctx);
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

  // Auto-stake plan teaser. Pulls toggle/lock from preset; per-launch override
  // (set via the "Stake lock" button on this confirm screen) wins when present.
  const userId = ctx.from!.id.toString();
  const preset = await presetStore.get(userId);
  const effectiveLockPeriod = launch.stakeLockPeriodOverride ?? preset.stakeLockPeriod;
  const stakePlan = planAutoStake({
    feeSink: launch.feeSink!,
    initialBuySol: launch.initialBuySol ?? 0,
    hasSolanaChain: hasSolana,
    autoStakeInitial: preset.autoStakeInitial,
    stakeLockPeriod: effectiveLockPeriod,
  });
  const stakeStatusLine = renderAutoStakeStatus(stakePlan);
  const stakeBlock = stakeStatusLine ? `\n${stakeStatusLine}` : '';
  const confirmKbOpts = stakePlan.willStake ? { stakeLockDays: effectiveLockPeriod } : undefined;

  try {
    const quote = await printr.quote(quoteBody);
    await cleanSend(ctx, `${summary}\n\n${formatQuote(quote)}${stakeBlock}\n\n<b>Confirm launch?</b>`, confirmKeyboard(confirmKbOpts));
  } catch (err) {
    const msg = err instanceof PrintrApiError ? `API: ${err.detail}` : 'Could not fetch quote';
    await cleanSend(ctx, `${summary}\n\n⚠️ ${esc(msg)}${stakeBlock}\n\n<b>Launch anyway?</b>`, confirmKeyboard(confirmKbOpts));
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
  // Honor the user's "Set as Default" pick when they have multiple wallets
  // of the same type — getWalletForType prefers is_default and falls back
  // to the oldest of the requested type.
  const evmWallet = await walletStore.getWalletForType(userId, 'evm');
  const svmWallet = await walletStore.getWalletForType(userId, 'svm');
  const defaultWallet = await walletStore.getDefaultWallet(userId);
  const preset = await presetStore.get(userId);

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

  // ── Pre-flight balance check ──
  // print_telecoin2 internally wraps SOL for the initial buy and creates
  // several Token-2022 accounts (mint, ATAs, dev_config). On top of that we
  // prepend the blastr fee transfer and (when staking) append a
  // stake_position PDA. If the wallet can't cover all of it the launch will
  // revert with SPL Token Custom:1 (InsufficientFunds), but only AFTER
  // Printr has reserved the ticker for 48h. Catch it here instead.
  const launchTouchesSolana = chains.some((c) => c.startsWith('solana:'));
  if (launchTouchesSolana && svmWallet) {
    const willStakeForCheck = preset.autoStakeInitial && launch.feeSink === 'stake_pool' && (launch.initialBuySol ?? 0) > 0;
    const initialBuyLamports = (launch.initialBuySol ?? 0) > 0
      ? Math.floor((launch.initialBuySol ?? 0) * LAMPORTS_PER_SOL)
      : 100_000;
    const blastrFeeLamports = config.blastrFeeRecipientSvm && config.blastrFeeSol > 0
      ? Math.round(config.blastrFeeSol * LAMPORTS_PER_SOL)
      : 0;
    const RENT_BUFFER_LAMPORTS = 15_000_000; // ~0.015 SOL: mint + ATAs + tx fees
    const STAKE_RENT_LAMPORTS = willStakeForCheck ? 5_000_000 : 0; // ~0.005 SOL stake position
    const requiredLamports = initialBuyLamports + blastrFeeLamports + RENT_BUFFER_LAMPORTS + STAKE_RENT_LAMPORTS;
    try {
      const conn = new Connection(config.solanaRpcUrl, 'confirmed');
      const balance = await conn.getBalance(new PublicKey(svmWallet.address));
      if (balance < requiredLamports) {
        const need = (requiredLamports / LAMPORTS_PER_SOL).toFixed(4);
        const have = (balance / LAMPORTS_PER_SOL).toFixed(4);
        await cleanSend(
          ctx,
          `❌ <b>Insufficient SOL</b>\n\n` +
            `Your balance: <b>${have} SOL</b>\n` +
            `Required:     <b>≥${need} SOL</b>\n\n` +
            `<i>Breakdown: ${(initialBuyLamports / LAMPORTS_PER_SOL).toFixed(3)} initial buy + ${(blastrFeeLamports / LAMPORTS_PER_SOL).toFixed(3)} blastr fee + ~${((RENT_BUFFER_LAMPORTS + STAKE_RENT_LAMPORTS) / LAMPORTS_PER_SOL).toFixed(3)} rents/fees${willStakeForCheck ? ' (incl. stake position)' : ''}.</i>\n\n` +
            `Top up your wallet and try again. Ticker is still available — no Printr lock yet.`,
          mainMenuKeyboard(),
        );
        return ctx.scene.leave();
      }
    } catch (err) {
      logger.warn({ err, userId }, 'pre-flight balance check failed; proceeding anyway');
    }
  }

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

    // Best-effort record so /mytokens can list it later. Also stash swap
    // accounts from the launch payload so the trade panel can sell later.
    const svmPayloadForCtx = payload as unknown as SvmPayload;
    const swapCtx =
      svmPayloadForCtx.ixs && svmPayloadForCtx.mint_address
        ? extractSwapContext(svmPayloadForCtx.ixs, svmPayloadForCtx.mint_address)
        : null;
    void tokenStore
      .record(userId, result.token_id, launch.name!, launch.symbol!, chains, swapCtx)
      .catch((err) => logger.warn({ err, userId, tokenId: result.token_id }, 'tokenStore.record failed'));

    logger.debug({ userId, payloadKeys: Object.keys(payload) }, 'launch payload');

    // Determine chain types in this launch
    const hasSolana = chains.some((c) => c.startsWith('solana:'));
    const hasEvm = chains.some((c) => !c.startsWith('solana:'));

    // Auto-sign with the matching wallet
    let signed = false;

    // Captured for the public launch feed at the end. Only set on actual
    // submit success — never on signing failures or aborted auto-stake.
    let publishSig: string | undefined;
    let publishHash: string | undefined;
    let publishMint: string | undefined;
    let publishStakePlan: AutoStakePlan | undefined;

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

        // ── Auto-stake the initial buy in the same atomic tx ──
        let stakeIxs: TransactionInstruction[] | undefined;
        let stakeOutcome = '';
        const svmPayload = payload as unknown as SvmPayload;
        const stakePlan = planAutoStake({
          feeSink: launch.feeSink!,
          initialBuySol: launch.initialBuySol ?? 0,
          hasSolanaChain: hasSolana,
          autoStakeInitial: preset.autoStakeInitial,
          stakeLockPeriod: launch.stakeLockPeriodOverride ?? preset.stakeLockPeriod,
        });
        const initialBuyAmt = result.quote?.initial_buy_amount;

        // Diagnostic: dump everything the auto-stake decision touches so logs
        // show exactly which condition gates the build.
        logger.info(
          {
            userId,
            willStake: stakePlan.willStake,
            reason: stakePlan.reason,
            hasMint: !!svmPayload.mint_address,
            mintValue: svmPayload.mint_address,
            hasInitialBuyAmt: !!initialBuyAmt,
            initialBuyAmt,
            payloadIxsCount: svmPayload.ixs?.length,
            quoteKeys: result.quote ? Object.keys(result.quote) : [],
            payloadKeys: Object.keys(svmPayload),
          },
          'auto-stake decision (launch flow)',
        );

        // Auto-stake is fail-CLOSED: if the user opted in and we can't build
        // the stake ix, we abort the launch tx submission rather than ship a
        // token that's missing the dev's first-staker position. Better to bail
        // (and waste the ticker for 48h on Printr's anti-vamp lock) than to
        // surprise the dev with an un-staked launch.
        if (stakePlan.willStake) {
          const mintForStake = svmPayload.mint_address ? normalizeMint(svmPayload.mint_address) : undefined;
          if (!mintForStake || !initialBuyAmt) {
            logger.warn(
              { userId, hasMint: !!svmPayload.mint_address, hasInitialBuyAmt: !!initialBuyAmt },
              'auto-stake plan ready but payload incomplete — aborting launch',
            );
            await cleanSend(
              ctx,
              `${tokenMsg}\n\n⚠️ <b>Launch aborted</b> — auto-stake setup failed (Printr payload missing mint or quote amount). The launch tx was not submitted.\n\n` +
                `<i>Note: Printr may reserve your ticker for 48h. Use a different name to retry sooner, or switch fee sink to Creator/Buyback in /settings to launch without auto-stake.</i>`,
              mainMenuKeyboard(),
            );
            signed = true;
            return ctx.scene.leave();
          }
          try {
            // initial_buy_amount from Printr is in HUMAN units (whole tokens),
            // not raw atomic units. Scale by 10^decimals to get the raw u64
            // we pass to create_stake_position. Pull decimals from the asset
            // metadata in the quote, defaulting to 9 (Printr standard).
            const telecoinAsset = result.quote?.assets?.find(
              (a) => a.symbol?.toUpperCase() === launch.symbol?.toUpperCase(),
            );
            const decimals = telecoinAsset?.decimals ?? 9;
            const rawHumanAmt = BigInt(initialBuyAmt) * (10n ** BigInt(decimals));
            // 95% buffer for curve slippage between quote and execution.
            // First-buyer slippage on a fresh DBC is typically < 5%; if real
            // launches start reverting with InsufficientFunds we lower further.
            const toStake = (rawHumanAmt * 95n) / 100n;
            const conn = new Connection(config.solanaRpcUrl, 'confirmed');
            const lockForLaunch = launch.stakeLockPeriodOverride ?? preset.stakeLockPeriod;
            stakeIxs = await buildAutoStakeIxs({
              payloadIxs: svmPayload.ixs,
              owner: new PublicKey(svmWallet.address),
              telecoinMint: new PublicKey(mintForStake),
              toStakeAmount: toStake,
              lockPeriod: lockForLaunch,
              connection: conn,
            });
            stakeOutcome = `\n🔒 Auto-staked initial buy → ${lockForLaunch}d lock`;
            logger.info(
              { userId, lock: lockForLaunch, decimals, humanAmt: initialBuyAmt, toStakeRaw: toStake.toString() },
              'auto-stake ixs built (launch flow)',
            );
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : 'unknown';
            logger.warn({ err, userId }, 'auto-stake ix build failed — aborting launch');
            await cleanSend(
              ctx,
              `${tokenMsg}\n\n⚠️ <b>Launch aborted</b> — auto-stake build failed: ${esc(errMsg)}\n\n` +
                `<i>Note: Printr may reserve your ticker for 48h. Use a different name to retry sooner, or switch fee sink to Creator/Buyback in /settings to launch without auto-stake.</i>`,
              mainMenuKeyboard(),
            );
            signed = true;
            return ctx.scene.leave();
          }
        } else if (launch.feeSink === 'stake_pool') {
          stakeOutcome = `\n${renderAutoStakeStatus(stakePlan)}`;
        }

        const svmResult = await signAndSubmitSvm(svmPayload, key, undefined, svmFee, stakeIxs);
        publishSig = svmResult.signature;
        publishStakePlan = stakePlan;
        if (svmPayload.mint_address) publishMint = normalizeMint(svmPayload.mint_address);
        const successMsg =
          `${tokenMsg}\n\n<b>📡 Transaction Submitted</b>\n` +
          `<b>Signature:</b> <code>${svmResult.signature}</code>\n` +
          `<b>Status:</b> ${svmResult.confirmation_status}` +
          stakeOutcome;
        try {
          await cleanSend(ctx, successMsg, postLaunchKeyboard(result.token_id));
        } catch (renderErr) {
          // Sign succeeded — only the result message render failed. Log + send
          // a simpler fallback instead of the misleading "signing failed" label.
          logger.warn({ err: renderErr, userId, sig: svmResult.signature }, 'post-launch render failed');
          await cleanSend(ctx, successMsg, mainMenuKeyboard());
        }
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
        publishHash = evmResult.tx_hash;
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

    // Anonymous announce to the public launch feed — fire-and-forget. Only
    // posts when at least one chain actually submitted; helper no-ops if
    // LAUNCH_FEED_CHANNEL_ID isn't configured.
    if (publishSig || publishHash) {
      void publishLaunch(ctx.telegram, {
        name: launch.name!,
        symbol: launch.symbol!,
        chains,
        tokenId: result.token_id,
        imageBase64: launch.image || undefined,
        signature: publishSig,
        txHash: publishHash,
        mintAddress: publishMint,
        stakePlan: publishStakePlan,
        appUrl,
      });
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
  await promptName(ctx);
});

// ── Back navigation ──
// STEP_PROMPTS[N] re-prompts the input that step N expects. Triggered by
// the "← Back" button which fires `wiz:back`.
const STEP_PROMPTS = [
  promptName,             // 0
  promptSymbol,           // 1
  promptDescription,      // 2
  promptSocials,          // 3
  promptImage,            // 4
  promptChains,           // 5
  promptInitialBuy,       // 6
  promptGraduation,       // 7
  promptAdvancedToggle,   // 8
  promptMaxSupply,        // 9
  promptSupplyRatio,      // 10
  promptBondingFee,       // 11
  promptAmmFee,           // 12
  promptFeeSink,          // 13
];

launchScene.action('wiz:back', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const cur = ctx.wizard.cursor;
  if (cur === 0) return; // no previous step
  ctx.wizard.selectStep(cur - 1);
  const promptFn = STEP_PROMPTS[cur - 1];
  if (promptFn) await promptFn(ctx);
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

// ── Stake-lock override on the confirm screen ──
// Lets the user change the auto-stake lock duration per-launch without
// touching their saved preset.

launchScene.action('confirm:lockedit', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const userId = ctx.from!.id.toString();
  const preset = await presetStore.get(userId);
  const current = ctx.session.launch.stakeLockPeriodOverride ?? preset.stakeLockPeriod;
  try {
    await ctx.editMessageReplyMarkup(lockPeriodPickerKeyboard(current).reply_markup);
  } catch {}
});

launchScene.action(/^confirm:locksel:/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const data = ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : '';
  const days = parseInt(data.split(':')[2], 10);
  const valid = [7, 14, 30, 60, 90, 180];
  if (!valid.includes(days)) return;
  ctx.session.launch.stakeLockPeriodOverride = days as (typeof valid)[number] as never;
  try {
    await ctx.editMessageReplyMarkup(confirmKeyboard({ stakeLockDays: days }).reply_markup);
  } catch {}
});

launchScene.action('confirm:lockcancel', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const userId = ctx.from!.id.toString();
  const preset = await presetStore.get(userId);
  const days = ctx.session.launch.stakeLockPeriodOverride ?? preset.stakeLockPeriod;
  try {
    await ctx.editMessageReplyMarkup(confirmKeyboard({ stakeLockDays: days }).reply_markup);
  } catch {}
});

launchScene.action('action:wallet', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); await ctx.scene.leave(); return walletDashboard(ctx); });
launchScene.action('action:start', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); await ctx.scene.leave(); return startCommand(ctx); });
launchScene.action('action:launch', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); });
launchScene.action('action:help', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); await ctx.scene.leave(); return helpCommand(ctx); });
launchScene.action('action:quote', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); await ctx.scene.leave(); return quoteCommand(ctx); });
