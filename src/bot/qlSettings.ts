import type { BotContext } from './context.js';
import { presetStore, DEFAULT_QUICK_PRESET } from '../store/presets.js';
import { chainLabel } from '../printr/chains.js';
import { SINK_LABEL, SUPPLY_LABEL, esc } from './format.js';
import { cleanSend } from './helpers.js';
import type { FeeSink, MaxTelecoinSupply } from '../printr/types.js';
import {
  qlSettingsMenuKeyboard,
  qlBackKeyboard,
  qlChainKeyboard,
  qlGraduationKeyboard,
  qlMaxSupplyKeyboard,
  qlSupplyRatioKeyboard,
  qlBondingFeeKeyboard,
  qlAmmFeeKeyboard,
  qlFeeSinkKeyboard,
  qlProfileKeyboard,
  qlAutoStakeKeyboard,
  qlStakeLockKeyboard,
} from './keyboards.js';
import type { LockPeriodDays } from '../printr/stake.js';

async function summary(userId: string): Promise<string> {
  const p = await presetStore.get(userId);
  const chains = p.chains.map(chainLabel).join(', ') || '—';
  const lines = [
    '⚙️ <b>Quick Launch Settings</b>',
    '',
    `<b>Chain(s):</b> ${chains}`,
    `<b>Initial Buy:</b> $${p.initialBuyUsd}`,
    `<b>Graduation:</b> $${p.graduationThreshold.toLocaleString()}`,
    `<b>Max Supply:</b> ${SUPPLY_LABEL[p.maxSupply] ?? p.maxSupply}`,
    `<b>Curve Supply:</b> ${(p.supplyOnCurveBps / 100).toFixed(0)}%`,
    `<b>Curve Dev Fee:</b> ${(p.bondingCurveDevFeeBps / 100).toFixed(2)}%`,
    `<b>AMM Dev Fee:</b> ${(p.ammDevFeeBps / 100).toFixed(2)}%`,
    `<b>Fee Sink:</b> ${SINK_LABEL[p.feeSink] ?? p.feeSink}`,
  ];
  if (p.feeSink === 'stake_pool') {
    lines.push(`<b>Auto-Stake Initial:</b> ${p.autoStakeInitial ? 'on' : 'off'}`);
    lines.push(`<b>Stake Lock:</b> ${p.stakeLockPeriod}d`);
  }
  lines.push(`<b>Profile:</b> ${esc(p.profile)}`);
  lines.push('', 'Pick a field to edit:');
  return lines.join('\n');
}

export async function qlSettingsDashboard(ctx: BotContext) {
  ctx.session._qlSettingsEdit = false;
  const userId = ctx.from!.id.toString();
  const preset = await presetStore.get(userId);
  await cleanSend(ctx, await summary(userId), qlSettingsMenuKeyboard(preset));
}

/**
 * Handle every `qls:*` callback. Returns true if handled.
 */
export async function handleQlSettingsCallback(ctx: BotContext, data: string): Promise<boolean> {
  const userId = ctx.from!.id.toString();

  if (data === 'qls:reset') {
    await presetStore.reset(userId);
    await cleanSend(ctx, '♻️ Reset to defaults.\n\n' + (await summary(userId)), qlSettingsMenuKeyboard(await presetStore.get(userId)));
    return true;
  }

  if (data.startsWith('qls:edit:')) {
    const field = data.slice(9);
    return openEditor(ctx, field);
  }

  if (data.startsWith('qls:chain:')) {
    const caip2 = data.slice(10);
    const preset = await presetStore.get(userId);
    const chains = [...preset.chains];
    const idx = chains.indexOf(caip2);
    if (idx >= 0) chains.splice(idx, 1);
    else chains.push(caip2);
    await presetStore.update(userId, { chains });
    try {
      await ctx.editMessageReplyMarkup(qlChainKeyboard(chains).reply_markup);
    } catch {}
    return true;
  }

  if (data === 'qls:chains:done') {
    const preset = await presetStore.get(userId);
    if (preset.chains.length === 0) {
      await cleanSend(ctx, '⚠️ Pick at least one chain.', qlChainKeyboard([]));
      return true;
    }
    await qlSettingsDashboard(ctx);
    return true;
  }

  if (data.startsWith('qls:grad:')) {
    const v = parseInt(data.slice(9), 10);
    await presetStore.update(userId, { graduationThreshold: v });
    await qlSettingsDashboard(ctx);
    return true;
  }

  if (data.startsWith('qls:supply:')) {
    const v = data.slice(11) as MaxTelecoinSupply;
    await presetStore.update(userId, { maxSupply: v });
    await qlSettingsDashboard(ctx);
    return true;
  }

  if (data.startsWith('qls:ratio:')) {
    const v = parseInt(data.slice(10), 10);
    await presetStore.update(userId, { supplyOnCurveBps: v });
    await qlSettingsDashboard(ctx);
    return true;
  }

  if (data.startsWith('qls:bond:')) {
    const v = parseInt(data.slice(9), 10);
    await presetStore.update(userId, { bondingCurveDevFeeBps: v });
    await qlSettingsDashboard(ctx);
    return true;
  }

  if (data.startsWith('qls:amm:')) {
    const v = parseInt(data.slice(8), 10);
    await presetStore.update(userId, { ammDevFeeBps: v });
    await qlSettingsDashboard(ctx);
    return true;
  }

  if (data.startsWith('qls:sink:')) {
    const v = data.slice(9) as FeeSink;
    await presetStore.update(userId, { feeSink: v });
    await qlSettingsDashboard(ctx);
    return true;
  }

  if (data.startsWith('qls:profile:')) {
    const v = data.slice(12);
    await presetStore.update(userId, { profile: v });
    await qlSettingsDashboard(ctx);
    return true;
  }

  if (data === 'qls:autostake:on' || data === 'qls:autostake:off') {
    await presetStore.update(userId, { autoStakeInitial: data.endsWith('on') });
    await qlSettingsDashboard(ctx);
    return true;
  }

  if (data.startsWith('qls:lock:')) {
    const days = parseInt(data.slice(9), 10) as LockPeriodDays;
    await presetStore.update(userId, { stakeLockPeriod: days });
    await qlSettingsDashboard(ctx);
    return true;
  }

  return false;
}

async function openEditor(ctx: BotContext, field: string): Promise<boolean> {
  const userId = ctx.from!.id.toString();
  const preset = await presetStore.get(userId);

  switch (field) {
    case 'chains':
      ctx.session._qlSettingsEdit = 'chains';
      await cleanSend(
        ctx,
        '🌐 <b>Chain(s) for Quick Launch</b>\n\nTap to toggle. Tap <b>Done</b> when finished.',
        qlChainKeyboard(preset.chains),
      );
      return true;
    case 'initialBuy':
      ctx.session._qlSettingsEdit = 'initialBuy';
      await cleanSend(
        ctx,
        `💵 <b>Initial Buy (USD)</b>\n\nCurrent: $${preset.initialBuyUsd}\n\nSend an amount (e.g. <b>10</b>, or <b>0</b> to skip):`,
        qlBackKeyboard(),
      );
      return true;
    case 'graduation':
      ctx.session._qlSettingsEdit = false;
      await cleanSend(ctx, '🎓 <b>Graduation threshold per chain</b>', qlGraduationKeyboard());
      return true;
    case 'maxSupply':
      ctx.session._qlSettingsEdit = false;
      await cleanSend(ctx, '🪙 <b>Max supply</b>', qlMaxSupplyKeyboard());
      return true;
    case 'supplyRatio':
      ctx.session._qlSettingsEdit = false;
      await cleanSend(ctx, '📈 <b>Bonding curve supply ratio</b>', qlSupplyRatioKeyboard());
      return true;
    case 'bondingFee':
      ctx.session._qlSettingsEdit = false;
      await cleanSend(ctx, '💸 <b>Bonding curve dev fee</b>', qlBondingFeeKeyboard());
      return true;
    case 'ammFee':
      ctx.session._qlSettingsEdit = false;
      await cleanSend(ctx, '💸 <b>AMM dev fee</b>', qlAmmFeeKeyboard());
      return true;
    case 'feeSink':
      ctx.session._qlSettingsEdit = false;
      await cleanSend(ctx, '🎯 <b>Fee sink</b>\n\nWhere collected fees route.', qlFeeSinkKeyboard());
      return true;
    case 'profile':
      ctx.session._qlSettingsEdit = false;
      await cleanSend(ctx, '🏷 <b>Token profile</b> <i>(UI label only)</i>', qlProfileKeyboard());
      return true;
    case 'autoStake':
      ctx.session._qlSettingsEdit = false;
      await cleanSend(
        ctx,
        '🔒 <b>Auto-stake initial buy</b>\n\n' +
          'When ON and your fee sink is the stake pool, your initial buy is locked into the stake pool in the same transaction as the launch — you become the first staker, ahead of any sniper.',
        qlAutoStakeKeyboard(preset.autoStakeInitial),
      );
      return true;
    case 'stakeLock':
      ctx.session._qlSettingsEdit = false;
      await cleanSend(
        ctx,
        '⏳ <b>Stake lock period</b>\n\n' +
          'How long your auto-staked tokens stay locked. Longer locks earn a bigger share of trading fees.',
        qlStakeLockKeyboard(preset.stakeLockPeriod),
      );
      return true;
  }
  return false;
}

/**
 * Text handler for editor fields that take free text input (currently just initialBuy).
 * Returns true if the text was consumed.
 */
export async function handleQlSettingsText(ctx: BotContext): Promise<boolean> {
  const mode = ctx.session._qlSettingsEdit;
  if (!mode) return false;
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : undefined;
  if (!text) return false;
  const userId = ctx.from!.id.toString();

  if (mode === 'initialBuy') {
    const amount = parseFloat(text.replace(/[$,]/g, ''));
    if (isNaN(amount) || amount < 0) {
      await cleanSend(ctx, '❌ Invalid amount. Send a number (e.g. 10):', qlBackKeyboard());
      return true;
    }
    await presetStore.update(userId, { initialBuyUsd: amount });
    ctx.session._qlSettingsEdit = false;
    await qlSettingsDashboard(ctx);
    return true;
  }

  return false;
}

export { DEFAULT_QUICK_PRESET };
