import http from 'node:http';
import type { Telegraf } from 'telegraf';
import { config } from './config.js';
import { logger } from './logger.js';
import type { BotContext } from './bot/context.js';

/**
 * Build the HTTP server for webhook intake and health checks.
 *
 * `bot.webhookCallback` already verifies the X-Telegram-Bot-Api-Secret-Token
 * header against `secretToken` and returns 401 on mismatch — so spoofed
 * POSTs from Internet randos are dropped before they reach Telegraf's update
 * handler.
 */
export function createServer(bot: Telegraf<BotContext>): http.Server {
  const webhookHandler = bot.webhookCallback(config.webhookPath, {
    secretToken: config.webhookSecret,
  });

  return http.createServer(async (req, res) => {
    const url = req.url ?? '/';

    if (req.method === 'GET' && (url === '/health' || url === '/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (req.method === 'POST' && url === config.webhookPath) {
      try {
        await webhookHandler(req, res);
      } catch (err) {
        logger.error({ err }, 'webhook handler error');
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        }
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });
}
