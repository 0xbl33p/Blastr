import { Input, type Telegram } from 'telegraf';
import { config } from '../config.js';
import { chainLabel } from '../printr/chains.js';
import { logger } from '../logger.js';
import { esc } from './format.js';
import type { AutoStakePlan } from '../printr/stake.js';

export interface LaunchFeedPost {
  name: string;
  symbol: string;
  chains: string[];
  tokenId: string;
  /** Token image as base64 (no data: prefix). Posted as a photo when present. */
  imageBase64?: string;
  /** Solana tx signature, when this launch hit Solana. */
  signature?: string;
  /** EVM tx hash, when this launch hit an EVM chain. */
  txHash?: string;
  /** SPL mint address (Solana CA). Available immediately from the launch
   *  payload. EVM contract addresses are only known after deployments
   *  confirm, so we don't post EVM CAs in the feed. */
  mintAddress?: string;
  stakePlan?: AutoStakePlan;
  /** Printr app base URL — typically `${config.printrBaseUrl}` rewritten from api-preview to app. */
  appUrl: string;
}

/**
 * Post an anonymous launch announcement to the public feed channel.
 *
 * Fire-and-forget: never throws, never blocks the user reply. Skipped silently
 * when `LAUNCH_FEED_CHANNEL_ID` is unset. By design, no caller-supplied user
 * identifier (Telegram id, username, first_name) is ever accepted here — the
 * channel is anonymous.
 */
export async function publishLaunch(
  telegram: Telegram,
  post: LaunchFeedPost,
): Promise<void> {
  const channelId = config.launchFeedChannelId;
  if (!channelId) return;

  try {
    const caption = formatCaption(post);
    if (post.imageBase64) {
      const buf = Buffer.from(post.imageBase64, 'base64');
      // Telegram caption limit is 1024 chars; ours is well under.
      await telegram.sendPhoto(channelId, Input.fromBuffer(buf), {
        caption,
        parse_mode: 'HTML',
      });
    } else {
      await telegram.sendMessage(channelId, caption, {
        parse_mode: 'HTML',
      });
    }
  } catch (err) {
    // Most likely cause: bot isn't admin in the channel, or channel id is
    // wrong. We log but never propagate — the user's launch already landed.
    logger.warn(
      { err, tokenId: post.tokenId, channel: channelId },
      'launch feed publish failed',
    );
  }
}

function formatCaption(post: LaunchFeedPost): string {
  const chainNames = post.chains.map(chainLabel).join(' · ');
  const printrUrl = `${post.appUrl}/trade/${post.tokenId}`;

  const lines: string[] = [
    '🚀 <b>New launch on blastr</b>',
    '',
    `<b>${esc(post.name)}</b> (${esc(post.symbol)})`,
    `<b>Chain:</b> ${chainNames}`,
  ];

  if (post.mintAddress) {
    // <code> is tap-to-copy on Telegram mobile clients.
    lines.push(`🪙 <b>CA:</b> <code>${esc(post.mintAddress)}</code>`);
  }

  if (post.stakePlan?.willStake) {
    lines.push(`🔒 First staker · ${post.stakePlan.lockPeriod}d lock`);
  }

  lines.push('');

  // Solscan is well-known and stable — include it for SVM launches without
  // needing a per-chain explorer config. Skip for EVM launches (would need
  // a chain → explorer map; punted until needed).
  const links: string[] = [`<a href="${printrUrl}">View on Printr</a>`];
  if (post.signature) {
    links.push(`<a href="https://solscan.io/tx/${post.signature}">Tx</a>`);
  }
  lines.push(links.join(' · '));

  return lines.join('\n');
}
