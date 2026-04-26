import type { QuoteResult, Deployment, ExternalLinks } from '../printr/types.js';
import { chainLabel, getChain } from '../printr/chains.js';

export function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function formatQuote(quote: QuoteResult): string {
  const lines: string[] = ['<b>💰 Cost Breakdown</b>', ''];

  for (const cost of quote.costs) {
    const chain = chainLabel(cost.asset_id.split('/')[0] ?? cost.asset_id);
    const desc = cost.description ? ` (${cost.description})` : '';
    lines.push(`  ${esc(chain)}${esc(desc)}: <b>$${cost.cost_usd.toFixed(2)}</b>`);
  }

  lines.push('');
  lines.push(`<b>Total: $${quote.total.cost_usd.toFixed(2)}</b>`);

  if (quote.initial_buy_amount) {
    lines.push(`Tokens from initial buy: <code>${quote.initial_buy_amount}</code>`);
  }

  return lines.join('\n');
}

export const SUPPLY_LABEL: Record<string, string> = {
  '100_million': '100M',
  '1_billion': '1B',
  '10_billion': '10B',
};

export const SINK_LABEL: Record<string, string> = {
  dev: '👤 Creator',
  stake_pool: '💎 Proof of Belief',
  buyback: '🔥 Buyback & burn',
};

export function formatLaunchSummary(params: {
  name: string;
  symbol: string;
  description: string;
  chains: string[];
  initialBuySol: number;
  graduationThreshold: number;
  hasImage?: boolean;
  maxSupply?: string;
  supplyOnCurveBps?: number;
  bondingCurveDevFeeBps?: number;
  ammDevFeeBps?: number;
  feeSink?: string;
  blastrFeeLabel?: string;
  externalLinks?: ExternalLinks;
  profile?: string;
}): string {
  const chainNames = params.chains.map(chainLabel).join(', ');

  const lines = [
    '<b>🚀 Token Launch Summary</b>',
    '',
    `<b>Name:</b> ${esc(params.name)}`,
    `<b>Symbol:</b> ${esc(params.symbol)}`,
    `<b>Description:</b> ${esc(params.description || '—')}`,
    `<b>Image:</b> ${params.hasImage ? '✅ uploaded' : '—'}`,
    `<b>Chain(s):</b> ${chainNames}`,
    `<b>Initial Buy:</b> ${params.initialBuySol} SOL`,
    `<b>Graduation:</b> $${params.graduationThreshold.toLocaleString()}`,
  ];

  if (params.maxSupply) {
    lines.push(`<b>Max Supply:</b> ${SUPPLY_LABEL[params.maxSupply] ?? params.maxSupply}`);
  }
  if (params.supplyOnCurveBps != null) {
    lines.push(`<b>Curve Supply:</b> ${(params.supplyOnCurveBps / 100).toFixed(0)}%`);
  }
  if (params.bondingCurveDevFeeBps != null) {
    lines.push(`<b>Curve Dev Fee:</b> ${(params.bondingCurveDevFeeBps / 100).toFixed(2)}%`);
  }
  if (params.ammDevFeeBps != null) {
    lines.push(`<b>AMM Dev Fee:</b> ${(params.ammDevFeeBps / 100).toFixed(2)}%`);
  }
  if (params.feeSink) {
    lines.push(`<b>Fee Sink:</b> ${SINK_LABEL[params.feeSink] ?? params.feeSink}`);
  }
  if (params.profile) {
    lines.push(`<b>Profile:</b> ${esc(params.profile)}`);
  }

  const socials = formatSocialsInline(params.externalLinks);
  if (socials) lines.push(`<b>Socials:</b> ${socials}`);

  if (params.blastrFeeLabel) {
    lines.push(`<b>blastr Fee:</b> ${params.blastrFeeLabel}`);
  }

  return lines.join('\n');
}

function formatSocialsInline(links?: ExternalLinks): string {
  if (!links) return '';
  const parts: string[] = [];
  if (links.website) parts.push(`🌐 ${esc(links.website)}`);
  if (links.x) parts.push(`𝕏 ${esc(links.x)}`);
  if (links.telegram) parts.push(`✈️ ${esc(links.telegram)}`);
  if (links.github) parts.push(`🐙 ${esc(links.github)}`);
  return parts.join(' · ');
}

export function formatDeployments(deployments: Deployment[]): string {
  if (deployments.length === 0) return 'No deployments found.';

  const statusEmoji: Record<string, string> = {
    pending: '⏳',
    confirming: '🔄',
    live: '✅',
    failed: '❌',
  };

  const lines = ['<b>📊 Deployment Status</b>', ''];

  for (const d of deployments) {
    const emoji = statusEmoji[d.status] ?? '❓';
    const chain = chainLabel(d.chain);
    lines.push(`${emoji} <b>${esc(chain)}</b>: ${d.status}`);
    if (d.tx_hash) lines.push(`   tx: <code>${d.tx_hash}</code>`);
    if (d.contract_address) lines.push(`   contract: <code>${d.contract_address}</code>`);
    if (d.error) lines.push(`   error: ${esc(d.error)}`);
  }

  return lines.join('\n');
}

export function formatTokenCreated(
  tokenId: string,
  appUrl: string,
): string {
  return [
    '<b>✅ Token Created!</b>',
    '',
    `<b>Token ID:</b> <code>${tokenId}</code>`,
    '',
    `<a href="${appUrl}/trade/${tokenId}">View on Printr</a>`,
  ].join('\n');
}

export function formatTxResult(txHash: string, status: string): string {
  return [
    '<b>📡 Transaction Submitted</b>',
    '',
    `<b>Status:</b> ${status}`,
    `<b>Hash:</b> <code>${txHash}</code>`,
  ].join('\n');
}
