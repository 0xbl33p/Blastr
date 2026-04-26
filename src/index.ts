import { Telegraf, Scenes, session } from 'telegraf';
import { config, validateConfig, isWebhookMode } from './config.js';
import { logger } from './logger.js';
import { sql, closeDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { redis, createRedisSessionStore, closeRedis } from './redis.js';
import { createServer } from './server.js';
import type { BotContext, SessionData } from './bot/context.js';
import { walletStore } from './store/wallets.js';
import { launchScene } from './bot/scenes/launch.js';
import { quickLaunchScene } from './bot/scenes/quickLaunch.js';
import {
  startCommand,
  helpCommand,
  quoteCommand,
  statusCommand,
  walletDashboard,
  myTokensCommand,
  handleWalletCallbacks,
  handleWalletImportText,
  handleQuoteChainCb,
  handleQuoteAmount,
} from './bot/commands.js';
import {
  qlSettingsDashboard,
  handleQlSettingsCallback,
  handleQlSettingsText,
} from './bot/qlSettings.js';
import { handleTradeCallback } from './bot/trade.js';
import { cleanSend } from './bot/helpers.js';
import { walletRequiredKeyboard } from './bot/keyboards.js';

async function requireWallet(ctx: BotContext): Promise<boolean> {
  const userId = ctx.from!.id.toString();
  if (await walletStore.getDefaultWallet(userId)) return true;
  await cleanSend(
    ctx,
    '⚠️ <b>Wallet required</b>\n\nCreate or import a wallet before launching a token.',
    walletRequiredKeyboard(),
  );
  return false;
}

async function main(): Promise<void> {
  validateConfig();
  logger.info({ webhookMode: isWebhookMode(), port: config.port }, 'starting blastr');

  // Boot data layer first — fail fast if DB/Redis unreachable.
  await sql`SELECT 1`;
  await runMigrations();
  await redis.ping();

  const bot = new Telegraf<BotContext>(config.botToken, {
    handlerTimeout: 90_000, // ms; abort handlers stuck longer than this
  });

  const stage = new Scenes.Stage<BotContext>([launchScene, quickLaunchScene]);
  bot.use(session({ store: createRedisSessionStore<SessionData>() }));
  bot.use(stage.middleware());

  // ── Commands ──
  bot.start(startCommand);
  bot.command('help', helpCommand);
  bot.command('wallet', walletDashboard);
  bot.command('quote', quoteCommand);
  bot.command('status', statusCommand);
  bot.command('settings', qlSettingsDashboard);
  bot.command('mytokens', myTokensCommand);

  bot.command('launch', async (ctx) => {
    if (!(await requireWallet(ctx))) return;
    return ctx.scene.enter('launch');
  });

  bot.command('quicklaunch', async (ctx) => {
    if (!(await requireWallet(ctx))) return;
    return ctx.scene.enter('quickLaunch');
  });

  // ── Callback queries ──
  bot.action(/^w:/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const data = ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : '';
    await handleWalletCallbacks(ctx, data);
  });

  bot.action(/^qls:/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const data = ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : '';
    await handleQlSettingsCallback(ctx, data);
  });

  bot.action(/^chain:/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const data = ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : '';
    await handleQuoteChainCb(ctx, data);
  });

  bot.action('chains:done', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await handleQuoteChainCb(ctx, 'chains:done');
  });

  // Trade panel callbacks (trade:open|close|sell|do:<tokenId>:<percent>)
  bot.action(/^trade:/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const data = ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : '';
    await handleTradeCallback(ctx, data);
  });

  // ── Menu actions ──
  bot.action('action:launch', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await requireWallet(ctx))) return;
    return ctx.scene.enter('launch');
  });

  bot.action('action:quicklaunch', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await requireWallet(ctx))) return;
    return ctx.scene.enter('quickLaunch');
  });

  bot.action('action:qlsettings', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    return qlSettingsDashboard(ctx);
  });

  bot.action('action:quote', (ctx) => { ctx.answerCbQuery().catch(() => {}); return quoteCommand(ctx); });
  bot.action('action:status', (ctx) => { ctx.answerCbQuery().catch(() => {}); return statusCommand(ctx); });
  bot.action('action:mytokens', (ctx) => { ctx.answerCbQuery().catch(() => {}); return myTokensCommand(ctx); });
  bot.action('action:wallet', (ctx) => { ctx.answerCbQuery().catch(() => {}); return walletDashboard(ctx); });
  bot.action('action:help', (ctx) => { ctx.answerCbQuery().catch(() => {}); return helpCommand(ctx); });
  bot.action('action:start', (ctx) => { ctx.answerCbQuery().catch(() => {}); return startCommand(ctx); });

  // ── Text handler ──
  bot.on('text', async (ctx, next) => {
    if (await handleWalletImportText(ctx)) return;
    if (await handleQlSettingsText(ctx)) return;
    if (await handleQuoteAmount(ctx)) return;
    return next();
  });

  // ── Error boundary: don't let one bad update kill the process ──
  bot.catch((err, ctx) => {
    logger.error(
      {
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
        updateType: ctx.updateType,
        userId: ctx.from?.id,
      },
      'unhandled bot error',
    );
  });

  // ── Start: webhook in prod, long-polling fallback for dev ──
  let server: ReturnType<typeof createServer> | null = null;

  if (isWebhookMode()) {
    server = createServer(bot);
    await new Promise<void>((res) => server!.listen(config.port, res));
    logger.info({ port: config.port, path: config.webhookPath }, 'http server listening');

    const webhookUrl = `https://${config.webhookDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')}${config.webhookPath}`;
    await bot.telegram.setWebhook(webhookUrl, {
      secret_token: config.webhookSecret,
      // We handle our own retry semantics; let Telegram clear pending on cold boot.
      drop_pending_updates: false,
      allowed_updates: ['message', 'callback_query'],
    });
    logger.info({ webhookUrl }, 'webhook registered with telegram');
  } else {
    logger.warn(
      'WEBHOOK_DOMAIN / WEBHOOK_SECRET not set — falling back to long-polling (dev mode)',
    );
    // Fire-and-forget; bot.launch resolves only on stop.
    bot.launch().catch((err) => {
      logger.fatal({ err }, 'long-polling failed');
      process.exit(1);
    });
  }

  // ── Graceful shutdown ──
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutdown initiated');
    try {
      // Telegraf bot.stop() drains in-flight handlers and (in webhook mode)
      // also tells Telegram to stop sending us updates.
      bot.stop(signal);
    } catch (err) {
      logger.warn({ err }, 'bot.stop threw');
    }
    if (server) {
      await new Promise<void>((res) => server!.close(() => res()));
    }
    await Promise.allSettled([closeDb(), closeRedis()]);
    logger.info('shutdown complete');
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaughtException');
    void shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandledRejection');
  });

  logger.info('blastr is live');
}

main().catch((err) => {
  logger.fatal({ err: err instanceof Error ? { message: err.message, stack: err.stack } : err }, 'fatal boot error');
  process.exit(1);
});
