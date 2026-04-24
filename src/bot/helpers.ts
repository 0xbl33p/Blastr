import type { BotContext } from './context.js';
import type { Message } from 'telegraf/types';

/** Delete the user's incoming message (for privacy / cleanup) */
export async function deleteUserMsg(ctx: BotContext) {
  try {
    if (ctx.message) {
      await ctx.deleteMessage(ctx.message.message_id);
    }
  } catch {
    /* bot may lack permission */
  }
}

/** Delete the last bot message we tracked */
async function deletePrevBotMsg(ctx: BotContext) {
  try {
    if (ctx.session._lastMsgId && ctx.chat) {
      await ctx.telegram.deleteMessage(ctx.chat.id, ctx.session._lastMsgId);
    }
  } catch {
    /* already deleted or expired */
  }
}

/** Delete previous bot message + user message, send new text, track its id */
export async function cleanSend(
  ctx: BotContext,
  text: string,
  extra?: object,
): Promise<Message.TextMessage> {
  await deleteUserMsg(ctx);
  await deletePrevBotMsg(ctx);
  const sent = await ctx.reply(text, { parse_mode: 'HTML' as const, ...extra });
  ctx.session._lastMsgId = sent.message_id;
  return sent;
}

/** Same as cleanSend but sends a photo with caption */
export async function cleanSendPhoto(
  ctx: BotContext,
  photo: Parameters<BotContext['replyWithPhoto']>[0],
  caption: string,
  extra?: object,
): Promise<Message.PhotoMessage> {
  await deleteUserMsg(ctx);
  await deletePrevBotMsg(ctx);
  const sent = await ctx.replyWithPhoto(photo, {
    caption,
    parse_mode: 'HTML' as const,
    ...extra,
  });
  ctx.session._lastMsgId = sent.message_id;
  return sent;
}

/** Same as cleanSend but sends an animation (GIF / MPEG4) with caption */
export async function cleanSendAnimation(
  ctx: BotContext,
  animation: Parameters<BotContext['replyWithAnimation']>[0],
  caption: string,
  extra?: object,
): Promise<Message.AnimationMessage> {
  await deleteUserMsg(ctx);
  await deletePrevBotMsg(ctx);
  const sent = await ctx.replyWithAnimation(animation, {
    caption,
    parse_mode: 'HTML' as const,
    ...extra,
  });
  ctx.session._lastMsgId = sent.message_id;
  return sent;
}

/** Delete previous + user msg, send new text, but DON'T track (for transient msgs) */
export async function cleanReplace(
  ctx: BotContext,
  text: string,
  extra?: object,
): Promise<Message.TextMessage> {
  await deleteUserMsg(ctx);
  await deletePrevBotMsg(ctx);
  const sent = await ctx.reply(text, { parse_mode: 'HTML' as const, ...extra });
  ctx.session._lastMsgId = sent.message_id;
  return sent;
}
