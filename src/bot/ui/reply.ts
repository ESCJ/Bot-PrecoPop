import { Markup } from "telegraf";
import type { InlineKeyboardMarkup } from "telegraf/types";
import { MyContext } from "../../domain/types";
import { throttler } from "../../infra/telegram/throttler";
import { truncateCaption, truncateMessage } from "./format";

type Keyboard = ReturnType<typeof Markup.inlineKeyboard>;

function isNotModified(err: unknown): boolean {
  const description =
    (err as { description?: string })?.description ?? (err as Error)?.message ?? "";
  return /message is not modified/i.test(description);
}

function isUneditable(err: unknown): boolean {
  const description =
    (err as { description?: string })?.description ?? (err as Error)?.message ?? "";
  return /message can't be edited|message to edit not found|there is no text in the message/i.test(
    description
  );
}

/**
 * Atualiza a mensagem atual quando possível; caso contrário envia uma nova.
 * Ignora "message is not modified", que é esperado ao reabrir a mesma tela.
 */
export async function render(ctx: MyContext, text: string, keyboard?: Keyboard): Promise<void> {
  const payload = {
    parse_mode: "HTML" as const,
    link_preview_options: { is_disabled: true },
    ...(keyboard ? { reply_markup: keyboard.reply_markup as InlineKeyboardMarkup } : {}),
  };
  const body = truncateMessage(text);

  if (ctx.callbackQuery && ctx.callbackQuery.message) {
    try {
      await ctx.editMessageText(body, payload);
      return;
    } catch (err) {
      if (isNotModified(err)) return;
      if (!isUneditable(err)) throw err;
      // Mensagem com foto ou já removida: envia uma nova abaixo.
    }
  }

  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;
  await throttler.schedule(chatId, () => ctx.reply(body, payload));
}

/** Envia uma mensagem nova, sempre respeitando o throttle. */
export async function send(ctx: MyContext, text: string, keyboard?: Keyboard): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;

  await throttler.schedule(chatId, () =>
    ctx.reply(truncateMessage(text), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(keyboard ? { reply_markup: keyboard.reply_markup as InlineKeyboardMarkup } : {}),
    })
  );
}

/** Envia foto com legenda; cai para texto puro se a foto falhar. */
export async function sendPhoto(
  ctx: MyContext,
  photoFileId: string | null,
  caption: string,
  keyboard?: Keyboard
): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;

  const markup = keyboard ? { reply_markup: keyboard.reply_markup as InlineKeyboardMarkup } : {};

  if (photoFileId) {
    try {
      await throttler.schedule(chatId, () =>
        ctx.replyWithPhoto(photoFileId, {
          caption: truncateCaption(caption),
          parse_mode: "HTML",
          ...markup,
        })
      );
      return;
    } catch {
      // Segue para o envio em texto.
    }
  }

  await send(ctx, caption, keyboard);
}

/** Responde ao callback silenciosamente, ignorando queries já expiradas. */
export async function ack(ctx: MyContext, text?: string): Promise<void> {
  try {
    await ctx.answerCbQuery(text);
  } catch {
    // Callback antigo: nada a fazer.
  }
}
