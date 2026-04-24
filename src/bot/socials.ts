import type { ExternalLinks } from '../printr/types.js';

/**
 * Parse a free-form socials block like:
 *   x: blastr
 *   telegram: https://t.me/blastr
 *   website: blastr.xyz
 *   github: blastr/blastr
 * Keys (case-insensitive): x/twitter, telegram/tg, website/site/web, github/gh.
 * Empty / unknown lines are ignored.
 */
export function parseSocials(text: string): ExternalLinks {
  const links: ExternalLinks = {};
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([a-zA-Z]+)\s*[:=]\s*(.+)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (!value) continue;
    if (key === 'x' || key === 'twitter') links.x = value;
    else if (key === 'telegram' || key === 'tg') links.telegram = value;
    else if (key === 'website' || key === 'site' || key === 'web' || key === 'url') links.website = value;
    else if (key === 'github' || key === 'gh') links.github = value;
  }
  return links;
}

/** Strip empty-string values so the API ignores unset fields cleanly. */
export function cleanExternalLinks(links: ExternalLinks | undefined): ExternalLinks | undefined {
  if (!links) return undefined;
  const out: ExternalLinks = {};
  if (links.website?.trim()) out.website = links.website.trim();
  if (links.x?.trim()) out.x = links.x.trim();
  if (links.telegram?.trim()) out.telegram = links.telegram.trim();
  if (links.github?.trim()) out.github = links.github.trim();
  return Object.keys(out).length > 0 ? out : undefined;
}

export const SOCIALS_PROMPT =
  '📎 <b>Socials</b> <i>(optional)</i>\n\n' +
  'Send one per line:\n' +
  '<code>x: yourhandle\n' +
  'telegram: https://t.me/...\n' +
  'website: yoursite.xyz\n' +
  'github: user/repo</code>\n\n' +
  'Tap <b>Skip</b> to launch without socials.';
