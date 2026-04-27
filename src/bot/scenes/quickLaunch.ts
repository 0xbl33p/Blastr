import { Scenes } from 'telegraf';
import { Connection, LAMPORTS_PER_SOL, PublicKey, type TransactionInstruction } from '@solana/web3.js';
import type { BotContext } from '../context.js';
import { printr, PrintrApiError } from '../../printr/client.js';
import { getChain } from '../../printr/chains.js';
import {
  signAndSubmitEvm,
  signAndSubmitSvm,
  type EvmSubmitResult,
  type SvmPayload,
} from '../../printr/signer.js';
import { buildAutoStakeIxs, planAutoStake, renderAutoStakeStatus, type AutoStakePlan } from '../../printr/stake.js';
import { extractSwapContext, normalizeMint } from '../../printr/sell.js';
import { walletStore } from '../../store/wallets.js';
import { presetStore } from '../../store/presets.js';
import { tokenStore } from '../../store/tokens.js';
import type { EvmPayload } from '../../printr/types.js';
import {
  confirmKeyboard,
  mainMenuKeyboard,
  socialsPromptKeyboard,
  postLaunchKeyboard,
  lockPeriodPickerKeyboard,
  justNav,
  withNav,
} from '../keyboards.js';
import {
  formatQuote,
  formatLaunchSummary,
  formatTokenCreated,
  formatTxResult,
  esc,
} from '../format.js';
import { cleanSend, deleteUserMsg } from '../helpers.js';
import { appendBlastrTag } from '../signature.js';
import { parseSocials, cleanExternalLinks, SOCIALS_PROMPT } from '../socials.js';
import { config } from '../../config.js';
import {
  startCommand,
  helpCommand,
  walletDashboard,
} from '../commands.js';
import { logger } from '../../logger.js';
import { publishLaunch } from '../launchFeed.js';

function getText(ctx: BotContext): string | undefined {
  return ctx.message && 'text' in ctx.message ? ctx.message.text : undefined;
}

function getCbData(ctx: BotContext): string | undefined {
  return ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
}

/** Skip + nav row. showBack=false on step 0 (no previous step to return to). */
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
// decrementing wizard.cursor. Step 0 has no back (justNav(false)).

async function promptName(ctx: BotContext) {
  await cleanSend(
    ctx,
    '⚡ <b>Quick Launch</b>\n\nUses your saved Quick Launch preset. ' +
      'Adjust defaults anytime via <b>⚙️ Settings</b>.\n\n' +
      'What should your token be called? <i>(1-32 characters)</i>',
    justNav(false),
  );
}
async function promptSymbol(ctx: BotContext) {
  await cleanSend(ctx, 'What ticker symbol? <i>(1-10 chars)</i>', justNav(true));
}
async function promptImage(ctx: BotContext) {
  await cleanSend(
    ctx,
    '🖼 <b>Token Image</b>\n\nSend a photo for your token logo <i>(JPEG or PNG, max 4MB)</i>.\n\nTap <b>Skip</b> to launch without an image.',
    skipButton(true),
  );
}
async function promptSocials(ctx: BotContext) {
  await cleanSend(ctx, SOCIALS_PROMPT, withNav(socialsPromptKeyboard(), true));
}

// ── Step 0: Name ──
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

// ── Step 1: Ticker ──
async function receiveSymbol(ctx: BotContext) {
  const text = getText(ctx);
  if (!text) return;
  if (text.length < 1 || text.length > 10) {
    await cleanSend(ctx, 'Symbol must be 1-10 characters. Try again:', justNav(true));
    return;
  }
  ctx.session.launch.symbol = text.toUpperCase();
  await promptImage(ctx);
  return ctx.wizard.next();
}

// ── Step 2: Image ──
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
  } else if (
    ctx.message &&
    'document' in ctx.message &&
    ctx.message.document?.mime_type?.startsWith('image/')
  ) {
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

  await promptSocials(ctx);
  return ctx.wizard.next();
}

// ── Step 3: Socials, then summary + confirm ──
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
  return showQuoteAndConfirm(ctx);
}

async function showQuoteAndConfirm(ctx: BotContext) {
  const userId = ctx.from!.id.toString();
  const preset = await presetStore.get(userId);
  const launch = ctx.session.launch;

  const initialBuy =
    preset.initialBuySol > 0
      ? { spend_native: Math.floor(preset.initialBuySol * LAMPORTS_PER_SOL).toString() }
      : { spend_native: '100000' }; // 0.0001 SOL — Printr requires non-zero to quote

  const quoteBody = {
    chains: preset.chains,
    initial_buy: initialBuy,
    graduation_threshold_per_chain_usd: preset.graduationThreshold,
    custom_fees: {
      bonding_curve_dev_fee_bps: preset.bondingCurveDevFeeBps,
      amm_dev_fee_bps: preset.ammDevFeeBps,
    },
    fee_sink: preset.feeSink,
    telecoin_supply_on_curve_ratio_bps: preset.supplyOnCurveBps,
    max_telecoin_supply: preset.maxSupply,
  };

  const hasSolana = preset.chains.some((c) => c.startsWith('solana:'));
  const hasEvm = preset.chains.some((c) => !c.startsWith('solana:'));
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
    chains: preset.chains,
    initialBuySol: preset.initialBuySol,
    graduationThreshold: preset.graduationThreshold,
    hasImage: !!launch.image,
    maxSupply: preset.maxSupply,
    supplyOnCurveBps: preset.supplyOnCurveBps,
    bondingCurveDevFeeBps: preset.bondingCurveDevFeeBps,
    ammDevFeeBps: preset.ammDevFeeBps,
    feeSink: preset.feeSink,
    profile: preset.profile,
    externalLinks: cleanExternalLinks(launch.externalLinks),
    blastrFeeLabel,
  });

  const effectiveLockPeriod = launch.stakeLockPeriodOverride ?? preset.stakeLockPeriod;
  const stakePlan = planAutoStake({
    feeSink: preset.feeSink,
    initialBuySol: preset.initialBuySol,
    hasSolanaChain: hasSolana,
    autoStakeInitial: preset.autoStakeInitial,
    stakeLockPeriod: effectiveLockPeriod,
  });
  const stakeStatusLine = renderAutoStakeStatus(stakePlan);
  const autoStakeLine = stakeStatusLine ? `\n${stakeStatusLine}` : '';
  const confirmKbOpts = stakePlan.willStake ? { stakeLockDays: effectiveLockPeriod } : undefined;

  try {
    const quote = await printr.quote(quoteBody);
    await cleanSend(
      ctx,
      `⚡ <b>Quick Launch</b>\n\n${summary}\n\n${formatQuote(quote)}${autoStakeLine}\n\n<b>Confirm launch?</b>`,
      confirmKeyboard(confirmKbOpts),
    );
  } catch (err) {
    const msg = err instanceof PrintrApiError ? `API: ${err.detail}` : 'Could not fetch quote';
    await cleanSend(
      ctx,
      `⚡ <b>Quick Launch</b>\n\n${summary}\n\n⚠️ ${esc(msg)}${autoStakeLine}\n\n<b>Launch anyway?</b>`,
      confirmKeyboard(confirmKbOpts),
    );
  }
  return ctx.wizard.next();
}

// ── Step 4: Confirm & create ──
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
  const preset = await presetStore.get(userId);
  const launch = ctx.session.launch;
  const chains = preset.chains;
  // Honor the user's "Set as Default" pick when they have multiple wallets
  // of the same type — getWalletForType prefers is_default and falls back
  // to the oldest of the requested type.
  const evmWallet = await walletStore.getWalletForType(userId, 'evm');
  const svmWallet = await walletStore.getWalletForType(userId, 'svm');
  const defaultWallet = await walletStore.getDefaultWallet(userId);

  const creatorAccounts = chains.map((chainCaip2) => {
    const chain = getChain(chainCaip2);
    if (chain?.type === 'svm' && svmWallet) return `${chainCaip2}:${svmWallet.address}`;
    if (chain?.type === 'evm' && evmWallet) return `${chainCaip2}:${evmWallet.address}`;
    return `${chainCaip2}:${defaultWallet?.address ?? ''}`;
  });

  const initialBuy =
    preset.initialBuySol > 0
      ? { spend_native: Math.floor(preset.initialBuySol * LAMPORTS_PER_SOL).toString() }
      : { spend_native: '100000' };

  // ── Pre-flight balance check ──  (see launch.ts for rationale)
  if (chains.some((c) => c.startsWith('solana:')) && svmWallet) {
    const willStakeForCheck = preset.autoStakeInitial && preset.feeSink === 'stake_pool' && preset.initialBuySol > 0;
    const initialBuyLamports = preset.initialBuySol > 0
      ? Math.floor(preset.initialBuySol * LAMPORTS_PER_SOL)
      : 100_000;
    const blastrFeeLamports = config.blastrFeeRecipientSvm && config.blastrFeeSol > 0
      ? Math.round(config.blastrFeeSol * LAMPORTS_PER_SOL)
      : 0;
    const RENT_BUFFER_LAMPORTS = 15_000_000;
    const STAKE_RENT_LAMPORTS = willStakeForCheck ? 5_000_000 : 0;
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

  await cleanSend(ctx, '⚡ Creating token on Printr...');

  try {
    const result = await printr.createToken({
      creator_accounts: creatorAccounts,
      name: launch.name!,
      symbol: launch.symbol!,
      description: appendBlastrTag(launch.description),
      image: launch.image || undefined,
      chains,
      initial_buy: initialBuy,
      graduation_threshold_per_chain_usd: preset.graduationThreshold,
      external_links: cleanExternalLinks(launch.externalLinks),
      custom_fees: {
        bonding_curve_dev_fee_bps: preset.bondingCurveDevFeeBps,
        amm_dev_fee_bps: preset.ammDevFeeBps,
      },
      fee_sink: preset.feeSink,
      telecoin_supply_on_curve_ratio_bps: preset.supplyOnCurveBps,
      max_telecoin_supply: preset.maxSupply,
    });

    const appUrl = config.printrBaseUrl.replace('api-preview', 'app');
    const tokenMsg = formatTokenCreated(result.token_id, appUrl);
    const payload = result.payload;

    // Record the launch — best-effort, not blocking. If this fails, the
    // launch still proceeds and the user just won't see it in /mytokens.
    // We also stash the swap accounts so /mytokens → Trade can build sell ixs
    // later without re-querying Printr.
    const svmPayloadForCtx = payload as unknown as SvmPayload;
    const swapCtx =
      svmPayloadForCtx.ixs && svmPayloadForCtx.mint_address
        ? extractSwapContext(svmPayloadForCtx.ixs, svmPayloadForCtx.mint_address)
        : null;
    void tokenStore
      .record(userId, result.token_id, launch.name!, launch.symbol!, chains, swapCtx)
      .catch((err) => logger.warn({ err, userId, tokenId: result.token_id }, 'tokenStore.record failed'));

    const hasSolana = chains.some((c) => c.startsWith('solana:'));
    const hasEvm = chains.some((c) => !c.startsWith('solana:'));

    let signed = false;

    // Captured for the public launch feed at the end. Only set on actual
    // submit success — never on signing failures or aborted auto-stake.
    let publishSig: string | undefined;
    let publishHash: string | undefined;
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
          feeSink: preset.feeSink,
          initialBuySol: preset.initialBuySol,
          hasSolanaChain: hasSolana,
          autoStakeInitial: preset.autoStakeInitial,
          stakeLockPeriod: launch.stakeLockPeriodOverride ?? preset.stakeLockPeriod,
        });
        const initialBuyAmt = result.quote?.initial_buy_amount;

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
          'auto-stake decision (quickLaunch)',
        );

        // Auto-stake is fail-CLOSED — see launch.ts for the rationale.
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
            // initial_buy_amount is in HUMAN units — see launch.ts for context.
            const telecoinAsset = result.quote?.assets?.find(
              (a) => a.symbol?.toUpperCase() === launch.symbol?.toUpperCase(),
            );
            const decimals = telecoinAsset?.decimals ?? 9;
            const rawHumanAmt = BigInt(initialBuyAmt) * (10n ** BigInt(decimals));
            const toStake = (rawHumanAmt * 95n) / 100n; // 5% slippage buffer
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
              'auto-stake ixs built (quickLaunch)',
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
        } else if (preset.feeSink === 'stake_pool') {
          stakeOutcome = `\n${renderAutoStakeStatus(stakePlan)}`;
        }

        const svmResult = await signAndSubmitSvm(svmPayload, key, undefined, svmFee, stakeIxs);
        publishSig = svmResult.signature;
        publishStakePlan = stakePlan;
        const successMsg =
          `${tokenMsg}\n\n<b>📡 Transaction Submitted</b>\n` +
          `<b>Signature:</b> <code>${svmResult.signature}</code>\n` +
          `<b>Status:</b> ${svmResult.confirmation_status}` +
          stakeOutcome;
        try {
          await cleanSend(ctx, successMsg, postLaunchKeyboard(result.token_id));
        } catch (renderErr) {
          logger.warn({ err: renderErr, userId, sig: svmResult.signature }, 'post-launch render failed');
          await cleanSend(ctx, successMsg, mainMenuKeyboard());
        }
        signed = true;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        logger.error({ err, userId, chain: 'svm', flow: 'quickLaunch' }, 'sign failed');
        await cleanSend(ctx, `${tokenMsg}\n\n❌ Solana signing failed: ${esc(errMsg)}`, mainMenuKeyboard());
        signed = true;
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
        logger.error({ err, userId, chain: 'evm', flow: 'quickLaunch' }, 'sign failed');
        await cleanSend(ctx, `${tokenMsg}\n\n❌ EVM signing failed: ${esc(errMsg)}`, mainMenuKeyboard());
        signed = true;
      }
    }

    // Anonymous announce to the public launch feed — fire-and-forget. Helper
    // no-ops when LAUNCH_FEED_CHANNEL_ID isn't configured.
    if (publishSig || publishHash) {
      void publishLaunch(ctx.telegram, {
        name: launch.name!,
        symbol: launch.symbol!,
        chains,
        tokenId: result.token_id,
        imageBase64: launch.image || undefined,
        signature: publishSig,
        txHash: publishHash,
        stakePlan: publishStakePlan,
        appUrl,
      });
    }

    if (!signed) {
      await cleanSend(
        ctx,
        `${tokenMsg}\n\n⚠️ Could not auto-sign. Your wallet doesn't match the preset's chain(s) — update Settings or add the right wallet.`,
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
          `Try again with a different ticker.`,
        mainMenuKeyboard(),
      );
    } else {
      await cleanSend(ctx, `❌ Launch failed: ${esc(detail || 'Unknown error')}`, mainMenuKeyboard());
    }
  }
  return ctx.scene.leave();
}

// ── Scene ──

export const quickLaunchScene = new Scenes.WizardScene<BotContext>(
  'quickLaunch',
  receiveName,     // 0
  receiveSymbol,   // 1
  receiveImage,    // 2
  receiveSocials,  // 3
  handleConfirm,   // 4
);

quickLaunchScene.enter(async (ctx) => {
  ctx.session.launch = { chains: [] };
  await promptName(ctx);
});

// ── Back navigation ──
// Map wizard cursor → re-prompt fn for the (cursor-1) step.
const STEP_PROMPTS = [promptName, promptSymbol, promptImage, promptSocials];

quickLaunchScene.action('wiz:back', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const cur = ctx.wizard.cursor;
  if (cur === 0) return; // no previous step
  ctx.wizard.selectStep(cur - 1);
  const promptFn = STEP_PROMPTS[cur - 1];
  if (promptFn) await promptFn(ctx);
});

quickLaunchScene.command('cancel', async (ctx) => {
  await cleanSend(ctx, 'Launch cancelled.', mainMenuKeyboard());
  return ctx.scene.leave();
});
quickLaunchScene.command('start', async (ctx) => { await ctx.scene.leave(); return startCommand(ctx); });
quickLaunchScene.command('wallet', async (ctx) => { await ctx.scene.leave(); return walletDashboard(ctx); });
quickLaunchScene.command('help', async (ctx) => { await ctx.scene.leave(); return helpCommand(ctx); });

// ── Stake-lock override on the confirm screen ──

quickLaunchScene.action('confirm:lockedit', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const userId = ctx.from!.id.toString();
  const preset = await presetStore.get(userId);
  const current = ctx.session.launch.stakeLockPeriodOverride ?? preset.stakeLockPeriod;
  try {
    await ctx.editMessageReplyMarkup(lockPeriodPickerKeyboard(current).reply_markup);
  } catch {}
});

quickLaunchScene.action(/^confirm:locksel:/, async (ctx) => {
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

quickLaunchScene.action('confirm:lockcancel', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const userId = ctx.from!.id.toString();
  const preset = await presetStore.get(userId);
  const days = ctx.session.launch.stakeLockPeriodOverride ?? preset.stakeLockPeriod;
  try {
    await ctx.editMessageReplyMarkup(confirmKeyboard({ stakeLockDays: days }).reply_markup);
  } catch {}
});

quickLaunchScene.action('action:wallet', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); await ctx.scene.leave(); return walletDashboard(ctx); });
quickLaunchScene.action('action:start', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); await ctx.scene.leave(); return startCommand(ctx); });
quickLaunchScene.action('action:help', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); await ctx.scene.leave(); return helpCommand(ctx); });
