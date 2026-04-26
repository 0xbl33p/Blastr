import { Markup } from 'telegraf';
import { CHAINS } from '../printr/chains.js';
import type { StoredWallet } from '../store/wallets.js';

export function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⚡ Quick Launch', 'action:quicklaunch')],
    [Markup.button.callback('🚀 Launch Token', 'action:launch')],
    [
      Markup.button.callback('📜 My Tokens', 'action:mytokens'),
      Markup.button.callback('📊 Status', 'action:status'),
    ],
    [
      Markup.button.callback('👛 Wallet', 'action:wallet'),
      Markup.button.callback('⚙️ Settings', 'action:qlsettings'),
    ],
    [Markup.button.callback('❓ Help', 'action:help')],
  ]);
}

// ── Wallet keyboards ──

export function walletListKeyboard(wallets: StoredWallet[], defaultId: string | null) {
  const rows = wallets.map((w) => {
    const icon = w.type === 'evm' ? '💎' : '☀️';
    const def = w.id === defaultId ? ' ⭐' : '';
    return [Markup.button.callback(`${icon} ${w.label}${def}`, `w:detail:${w.id}`)];
  });
  rows.push([
    Markup.button.callback('➕ Create Wallet', 'w:create'),
    Markup.button.callback('📥 Import Wallet', 'w:import'),
  ]);
  rows.push([Markup.button.callback('⬅️ Back', 'action:start')]);
  return Markup.inlineKeyboard(rows);
}

export function walletTypeKeyboard(action: 'create' | 'import') {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('💎 EVM', `w:${action}:evm`),
      Markup.button.callback('☀️ Solana', `w:${action}:svm`),
    ],
    [Markup.button.callback('⬅️ Back', 'action:wallet')],
  ]);
}

export function walletDetailKeyboard(walletId: string, isDefault: boolean) {
  const rows = [
    [Markup.button.callback('💰 Check Balance', `w:balance:${walletId}`)],
    [Markup.button.callback('📱 Show QR Code', `w:qr:${walletId}`)],
    [Markup.button.callback('🔑 Export Private Key', `w:export:${walletId}`)],
  ];
  if (!isDefault) {
    rows.push([Markup.button.callback('⭐ Set as Default', `w:default:${walletId}`)]);
  }
  rows.push([Markup.button.callback('🗑️ Delete Wallet', `w:delete:${walletId}`)]);
  rows.push([Markup.button.callback('⬅️ Back to Wallets', 'action:wallet')]);
  return Markup.inlineKeyboard(rows);
}

export function walletDeleteConfirmKeyboard(walletId: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Yes, Delete', `w:confirmdelete:${walletId}`),
      Markup.button.callback('❌ Cancel', `w:detail:${walletId}`),
    ],
  ]);
}

export function walletRequiredKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('👛 Set Up Wallet', 'action:wallet')],
  ]);
}

// ── Chain keyboard with optional type filter ──

export function chainKeyboard(selected: string[], allowedTypes?: Set<'evm' | 'svm'>) {
  const filtered = allowedTypes
    ? CHAINS.filter((c) => allowedTypes.has(c.type))
    : CHAINS;

  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < filtered.length; i += 2) {
    const row: ReturnType<typeof Markup.button.callback>[] = [];
    for (let j = i; j < i + 2 && j < filtered.length; j++) {
      const chain = filtered[j];
      const isSelected = selected.includes(chain.caip2);
      const label = isSelected
        ? `✅ ${chain.name}`
        : `${chain.emoji} ${chain.name}`;
      row.push(Markup.button.callback(label, `chain:${chain.caip2}`));
    }
    rows.push(row);
  }
  rows.push([Markup.button.callback('✔️ Confirm Selection', 'chains:done')]);
  return Markup.inlineKeyboard(rows);
}

export function graduationKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('$69,000', 'grad:69000'),
      Markup.button.callback('$250,000', 'grad:250000'),
    ],
  ]);
}

// ── advanced launch params ──

export function advancedToggleKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('⚡ Quick launch (defaults)', 'adv:skip'),
      Markup.button.callback('🛠 Advanced', 'adv:open'),
    ],
  ]);
}

export function maxSupplyKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('100M', 'supply:100_million'),
      Markup.button.callback('1B', 'supply:1_billion'),
      Markup.button.callback('10B', 'supply:10_billion'),
    ],
  ]);
}

export function supplyRatioKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('60% curve', 'ratio:6000'),
      Markup.button.callback('70% curve', 'ratio:7000'),
    ],
    [
      Markup.button.callback('80% curve', 'ratio:8000'),
      Markup.button.callback('85% curve', 'ratio:8500'),
    ],
  ]);
}

export function bondingFeeKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('0%', 'bond:0'),
      Markup.button.callback('0.5%', 'bond:50'),
      Markup.button.callback('1%', 'bond:100'),
      Markup.button.callback('1.5%', 'bond:150'),
    ],
  ]);
}

export function ammFeeKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('0%', 'amm:0'),
      Markup.button.callback('0.25%', 'amm:25'),
      Markup.button.callback('0.5%', 'amm:50'),
      Markup.button.callback('0.8%', 'amm:80'),
    ],
  ]);
}

export function feeSinkKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('👤 Creator', 'sink:dev')],
    [Markup.button.callback('💎 Proof of Belief', 'sink:stake_pool')],
    [Markup.button.callback('🔥 Buyback & burn', 'sink:buyback')],
  ]);
}

// ── Socials ──

export function socialsPromptKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⏭ Skip socials', 'skip')],
  ]);
}

// ── Quick Launch Settings ──

import type { QuickLaunchPreset } from '../store/presets.js';

export function qlSettingsMenuKeyboard(preset?: QuickLaunchPreset) {
  const rows: ReturnType<typeof Markup.button.callback>[][] = [
    [Markup.button.callback('🌐 Chain(s)', 'qls:edit:chains')],
    [Markup.button.callback('💵 Initial buy (USD)', 'qls:edit:initialBuy')],
    [Markup.button.callback('🎓 Graduation threshold', 'qls:edit:graduation')],
    [Markup.button.callback('🪙 Max supply', 'qls:edit:maxSupply')],
    [Markup.button.callback('📈 Curve supply ratio', 'qls:edit:supplyRatio')],
    [Markup.button.callback('💸 Curve dev fee', 'qls:edit:bondingFee')],
    [Markup.button.callback('💸 AMM dev fee', 'qls:edit:ammFee')],
    [Markup.button.callback('🎯 Fee sink', 'qls:edit:feeSink')],
  ];
  // Stake controls are only relevant when fees route to a stake pool.
  if (preset?.feeSink === 'stake_pool') {
    const onOff = preset.autoStakeInitial ? 'ON' : 'OFF';
    rows.push([Markup.button.callback(`🔒 Auto-stake initial: ${onOff}`, 'qls:edit:autoStake')]);
    rows.push([Markup.button.callback(`⏳ Stake lock: ${preset.stakeLockPeriod}d`, 'qls:edit:stakeLock')]);
  }
  rows.push([Markup.button.callback('🏷 Token profile', 'qls:edit:profile')]);
  rows.push([Markup.button.callback('♻️ Reset to defaults', 'qls:reset')]);
  rows.push([Markup.button.callback('⬅️ Back', 'action:start')]);
  return Markup.inlineKeyboard(rows);
}

export function qlAutoStakeKeyboard(current: boolean) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(current ? '✅ ON' : 'ON', 'qls:autostake:on'),
      Markup.button.callback(!current ? '✅ OFF' : 'OFF', 'qls:autostake:off'),
    ],
    [Markup.button.callback('⬅️ Back', 'action:qlsettings')],
  ]);
}

export function qlStakeLockKeyboard(current: number) {
  const opts: [string, number][] = [
    ['7d', 7], ['14d', 14], ['30d', 30], ['60d', 60], ['90d', 90], ['180d', 180],
  ];
  return Markup.inlineKeyboard([
    opts.slice(0, 3).map(([label, days]) =>
      Markup.button.callback(days === current ? `✅ ${label}` : label, `qls:lock:${days}`),
    ),
    opts.slice(3).map(([label, days]) =>
      Markup.button.callback(days === current ? `✅ ${label}` : label, `qls:lock:${days}`),
    ),
    [Markup.button.callback('⬅️ Back', 'action:qlsettings')],
  ]);
}

export function qlBackKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ Back to Settings', 'action:qlsettings')],
  ]);
}

export function qlChainKeyboard(selected: string[]) {
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < CHAINS.length; i += 2) {
    const row: ReturnType<typeof Markup.button.callback>[] = [];
    for (let j = i; j < i + 2 && j < CHAINS.length; j++) {
      const chain = CHAINS[j];
      const isSelected = selected.includes(chain.caip2);
      const label = isSelected ? `✅ ${chain.name}` : `${chain.emoji} ${chain.name}`;
      row.push(Markup.button.callback(label, `qls:chain:${chain.caip2}`));
    }
    rows.push(row);
  }
  rows.push([Markup.button.callback('✔️ Done', 'qls:chains:done')]);
  return Markup.inlineKeyboard(rows);
}

export function qlGraduationKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('$69,000', 'qls:grad:69000'),
      Markup.button.callback('$250,000', 'qls:grad:250000'),
    ],
    [Markup.button.callback('⬅️ Back', 'action:qlsettings')],
  ]);
}

export function qlMaxSupplyKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('100M', 'qls:supply:100_million'),
      Markup.button.callback('1B', 'qls:supply:1_billion'),
      Markup.button.callback('10B', 'qls:supply:10_billion'),
    ],
    [Markup.button.callback('⬅️ Back', 'action:qlsettings')],
  ]);
}

export function qlSupplyRatioKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('60%', 'qls:ratio:6000'),
      Markup.button.callback('70%', 'qls:ratio:7000'),
    ],
    [
      Markup.button.callback('80%', 'qls:ratio:8000'),
      Markup.button.callback('85%', 'qls:ratio:8500'),
    ],
    [Markup.button.callback('⬅️ Back', 'action:qlsettings')],
  ]);
}

export function qlBondingFeeKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('0%', 'qls:bond:0'),
      Markup.button.callback('0.4%', 'qls:bond:40'),
      Markup.button.callback('1%', 'qls:bond:100'),
      Markup.button.callback('1.5%', 'qls:bond:150'),
    ],
    [Markup.button.callback('⬅️ Back', 'action:qlsettings')],
  ]);
}

export function qlAmmFeeKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('0%', 'qls:amm:0'),
      Markup.button.callback('0.2%', 'qls:amm:20'),
      Markup.button.callback('0.5%', 'qls:amm:50'),
      Markup.button.callback('0.8%', 'qls:amm:80'),
    ],
    [Markup.button.callback('⬅️ Back', 'action:qlsettings')],
  ]);
}

export function qlFeeSinkKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('👤 Creator', 'qls:sink:dev')],
    [Markup.button.callback('💎 Proof of Belief', 'qls:sink:stake_pool')],
    [Markup.button.callback('🔥 Buyback & burn', 'qls:sink:buyback')],
    [Markup.button.callback('⬅️ Back', 'action:qlsettings')],
  ]);
}

export function qlProfileKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('memecoin', 'qls:profile:memecoin'),
      Markup.button.callback('utility', 'qls:profile:utility'),
    ],
    [
      Markup.button.callback('governance', 'qls:profile:governance'),
      Markup.button.callback('other', 'qls:profile:other'),
    ],
    [Markup.button.callback('⬅️ Back', 'action:qlsettings')],
  ]);
}

export function confirmKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Confirm & Launch', 'confirm:yes'),
      Markup.button.callback('❌ Cancel', 'confirm:no'),
    ],
  ]);
}

// ── Wizard escape hatch ──
// Every step of the launch wizard needs a way out for users who fat-finger an
// answer. action:start is already wired in both scenes to leave + return to
// the main menu, so we just bolt a "Menu" row onto every prompt's keyboard.

const wizardMenuButton = Markup.button.callback('🏠 Menu', 'action:start');

export function justMenu() {
  return Markup.inlineKeyboard([[wizardMenuButton]]);
}

/** Append a "Menu" row to an existing inline keyboard. */
export function withMenu(kb: ReturnType<typeof Markup.inlineKeyboard>) {
  return Markup.inlineKeyboard([
    ...kb.reply_markup.inline_keyboard,
    [wizardMenuButton],
  ]);
}
