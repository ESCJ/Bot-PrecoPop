import { Composer, Markup, Scenes } from "telegraf";
import { MyContext } from "../../../domain/types";
import { countUsers } from "../../../repositories/users.repo";
import { listRecentBroadcasts } from "../../../repositories/broadcasts.repo";
import { runBroadcast } from "../../../services/broadcast.service";
import { bold, esc, formatDate } from "../../ui/format";
import { CB, btn, rows } from "../../ui/keyboards";
import { ack, render, send, sendPhoto } from "../../ui/reply";
import { showAdminPanel } from "./panel";

export const BROADCAST_SCENE = "adminBroadcast";

export const adminBroadcastHandlers = new Composer<MyContext>();

adminBroadcastHandlers.action(CB.adminBroadcast, async (ctx) => {
  await ack(ctx);

  const [users, recent] = await Promise.all([countUsers(), listRecentBroadcasts(3)]);

  const history =
    recent.length > 0
      ? recent
          .map(
            (entry) =>
              `• ${esc(formatDate(entry.created_at))} — ${entry.sent_count} enviados, ` +
              `${entry.failed_count} falhas`
          )
          .join("\n")
      : "Nenhum comunicado enviado ainda.";

  await render(
    ctx,
    `${bold("Enviar comunicado")}\n\n` +
      `Destinatários alcançáveis: ${users.reachable} de ${users.total}\n\n` +
      `${bold("Últimos envios")}\n${history}`,
    Markup.inlineKeyboard(
      rows([btn.cb("Criar comunicado", "adm:bc:new")], [btn.cb("‹ Painel", CB.admin)])
    )
  );
});

adminBroadcastHandlers.action("adm:bc:new", async (ctx) => {
  await ack(ctx);
  await ctx.scene.enter(BROADCAST_SCENE);
});

interface BroadcastDraft {
  message?: string;
  photoFileId?: string | null;
}

function draft(ctx: MyContext): BroadcastDraft {
  const state = ctx.scene.session.state as { draft?: BroadcastDraft } | undefined;
  if (!state?.draft) {
    ctx.scene.session.state = { ...(ctx.scene.session.state ?? {}), draft: {} };
  }
  return (ctx.scene.session.state as { draft: BroadcastDraft }).draft;
}

export const broadcastScene = new Scenes.WizardScene<MyContext>(
  BROADCAST_SCENE,

  async (ctx) => {
    await send(
      ctx,
      `${bold("Novo comunicado")}\n\nEnvie a ${bold("mensagem")} que será entregue aos clientes.\n\n` +
        `Envie /cancelar para sair.`
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    const message = ctx.message;
    if (!message || !("text" in message)) return send(ctx, "Envie a mensagem em texto.");

    const value = message.text.trim();
    if (value.length < 5 || value.length > 900) {
      return send(ctx, "A mensagem deve ter entre 5 e 900 caracteres.");
    }

    draft(ctx).message = value;
    await send(
      ctx,
      `Quer anexar uma ${bold("foto")} ao comunicado?\n\n` +
        `Envie a imagem, ou a palavra ${bold("pular")}.`
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    const current = draft(ctx);
    const message = ctx.message;

    if (message && "photo" in message && message.photo.length > 0) {
      current.photoFileId = message.photo[message.photo.length - 1]!.file_id;
    } else {
      const text = message && "text" in message ? message.text.trim().toLowerCase() : "";
      if (text !== "pular") {
        return send(ctx, `Envie uma foto ou a palavra ${bold("pular")}.`);
      }
      current.photoFileId = null;
    }

    const users = await countUsers();

    await sendPhoto(
      ctx,
      current.photoFileId ?? null,
      `${bold("Pré-visualização")}\n\n${esc(current.message ?? "")}\n\n` +
        `Será enviado para ${bold(users.reachable)} cliente(s).`,
      Markup.inlineKeyboard([
        [btn.cb("Confirmar e enviar", "adm:bc:go")],
        [btn.cb("Cancelar", CB.admin)],
      ])
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    const data = ctx.callbackQuery && "data" in ctx.callbackQuery ? ctx.callbackQuery.data : null;

    if (data !== "adm:bc:go") {
      if (data === CB.admin) {
        await ack(ctx);
        await ctx.scene.leave();
        return showAdminPanel(ctx);
      }
      return send(ctx, "Use os botões acima para confirmar ou cancelar.");
    }

    await ack(ctx, "Enviando...");

    const current = draft(ctx);
    if (!current.message) {
      await ctx.scene.leave();
      return send(ctx, "Mensagem perdida. Comece novamente.");
    }

    await ctx.scene.leave();
    await send(ctx, "Comunicado em andamento. Você receberá o relatório ao final.");

    const result = await runBroadcast(ctx.telegram, {
      message: current.message,
      photoFileId: current.photoFileId ?? null,
      createdBy: ctx.from!.id,
    });

    await send(
      ctx,
      `${bold("Comunicado finalizado")}\n\n` +
        `Enviados: ${result.sent}\n` +
        `Falhas: ${result.failed}\n` +
        `Total de destinatários: ${result.total}`
    );

    return showAdminPanel(ctx);
  }
);

broadcastScene.command("cancelar", async (ctx) => {
  await ctx.scene.leave();
  await send(ctx, "Comunicado cancelado.");
  return showAdminPanel(ctx);
});
