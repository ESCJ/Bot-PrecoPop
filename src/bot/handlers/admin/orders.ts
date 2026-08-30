import { Composer, Markup, Scenes } from "telegraf";
import { config } from "../../../config/env";
import { MyContext } from "../../../domain/types";
import {
  countOrdersAwaitingShipment,
  findOrderWithItems,
  listOrdersAwaitingShipment,
  markOrderShipped,
} from "../../../repositories/orders.repo";
import { throttler } from "../../../infra/telegram/throttler";
import { logger } from "../../../infra/logger";
import { bold, code, esc, formatDate } from "../../ui/format";
import { CB, btn, cb, cbArgs, paginationRow, rows } from "../../ui/keyboards";
import { ack, render, send } from "../../ui/reply";
import { renderOrder } from "../../ui/views";
import { showAdminPanel } from "./panel";

export const TRACKING_SCENE = "adminTracking";

const PAGE_SIZE = 5;

export const adminOrdersHandlers = new Composer<MyContext>();

async function showOrdersPage(ctx: MyContext, page: number): Promise<void> {
  const total = await countOrdersAwaitingShipment();

  if (total === 0) {
    await render(
      ctx,
      `${bold("Pedidos a enviar")}\n\nNenhum pedido aguardando envio.`,
      Markup.inlineKeyboard([[btn.cb("‹ Painel", CB.admin)]])
    );
    return;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 1), totalPages);

  const orders = await listOrdersAwaitingShipment(PAGE_SIZE, (safePage - 1) * PAGE_SIZE);

  const orderRows = orders.map((order) => {
    const label = `#${order.id} · ${order.shipping_snapshot?.name ?? "Cliente"} · ${
      order.items.length
    } item(ns)`;
    return [btn.cb(label.slice(0, 60), cb(CB.adminOrderView, order.id))];
  });

  await render(
    ctx,
    `${bold("Pedidos a enviar")}\n\n${total} pedido(s) pago(s) aguardando envio.`,
    Markup.inlineKeyboard(
      rows(...orderRows, paginationRow(CB.adminOrdersPage, safePage, totalPages), [
        btn.cb("‹ Painel", CB.admin),
      ])
    )
  );
}

adminOrdersHandlers.action(new RegExp(`^${CB.adminOrdersPage}:(\\d+)$`), async (ctx) => {
  await ack(ctx);
  const [page] = cbArgs(ctx.match[0], CB.adminOrdersPage);
  await showOrdersPage(ctx, Number(page) || 1);
});

adminOrdersHandlers.action(new RegExp(`^${CB.adminOrderView}:(\\d+)$`), async (ctx) => {
  await ack(ctx);
  const [idRaw] = cbArgs(ctx.match[0], CB.adminOrderView);
  const order = await findOrderWithItems(Number(idRaw));

  if (!order) return ack(ctx, "Pedido não encontrado.");

  await render(
    ctx,
    renderOrder(order, true),
    Markup.inlineKeyboard(
      rows(
        order.status === "paid" && !order.shipped
          ? [btn.cb("Marcar como enviado", cb(CB.adminShip, order.id))]
          : [],
        [btn.cb("‹ Pedidos a enviar", cb(CB.adminOrdersPage, 1))],
        [btn.cb("Painel", CB.admin)]
      )
    )
  );
});

adminOrdersHandlers.action(new RegExp(`^${CB.adminShip}:(\\d+)$`), async (ctx) => {
  await ack(ctx);
  const [idRaw] = cbArgs(ctx.match[0], CB.adminShip);
  await ctx.scene.enter(TRACKING_SCENE, { orderId: Number(idRaw) });
});

/* ------------------------------------------------------------------ */
/* Cena: informar código de rastreio e notificar o cliente             */
/* ------------------------------------------------------------------ */

export const trackingScene = new Scenes.WizardScene<MyContext>(
  TRACKING_SCENE,

  async (ctx) => {
    const state = ctx.scene.session.state as { orderId?: number } | undefined;
    const order = state?.orderId ? await findOrderWithItems(state.orderId) : undefined;

    if (!order) {
      await send(ctx, "Pedido não encontrado.");
      return ctx.scene.leave();
    }

    await send(
      ctx,
      `${bold(`Enviar pedido #${order.id}`)}\n\n` +
        `Cliente: ${esc(order.shipping_snapshot?.name ?? "-")}\n\n` +
        `Envie o ${bold("código de rastreio")} dos Correios.\n\n` +
        `Se não houver rastreio, envie ${bold("sem")}.\n` +
        `Envie /cancelar para sair.`
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    const message = ctx.message;
    if (!message || !("text" in message)) return send(ctx, "Envie o código em texto.");

    const state = ctx.scene.session.state as { orderId: number };
    const raw = message.text.trim();

    let trackingCode: string | null = null;
    if (raw.toLowerCase() !== "sem") {
      const normalized = raw.toUpperCase().replace(/\s+/g, "");
      if (!/^[A-Z0-9]{8,40}$/.test(normalized)) {
        return send(
          ctx,
          "Código inválido. Use letras e números, por exemplo AA123456789BR.\n\n" +
            "Ou envie a palavra sem."
        );
      }
      trackingCode = normalized;
    }

    const order = await findOrderWithItems(state.orderId);
    if (!order) {
      await send(ctx, "Pedido não encontrado.");
      return ctx.scene.leave();
    }

    await markOrderShipped(order.id, trackingCode);
    await ctx.scene.leave();

    await notifyCustomerShipped(ctx, order.user_id, order.id, trackingCode);

    await send(
      ctx,
      `${bold("Pedido marcado como enviado!")}\n\n` +
        `Pedido #${order.id}` +
        (trackingCode ? `\nRastreio: ${code(trackingCode)}` : "") +
        `\n\nO cliente foi notificado.`
    );

    return showAdminPanel(ctx);
  }
);

trackingScene.command("cancelar", async (ctx) => {
  await ctx.scene.leave();
  await send(ctx, "Operação cancelada.");
  return showAdminPanel(ctx);
});

async function notifyCustomerShipped(
  ctx: MyContext,
  userId: number,
  orderId: number,
  trackingCode: string | null
): Promise<void> {
  const trackingBlock = trackingCode
    ? `\n\nCódigo de rastreio: ${code(trackingCode)}\n` +
      `Acompanhe em: https://rastreamento.correios.com.br/app/index.php`
    : "";

  const text =
    `${bold("Seu pedido foi enviado!")}\n\n` +
    `Pedido #${orderId} saiu para entrega em ${esc(formatDate(new Date()))}.` +
    trackingBlock +
    `\n\nObrigado por comprar na ${esc(config.storeName)}!`;

  try {
    await throttler.schedule(userId, () =>
      ctx.telegram.sendMessage(userId, text, { parse_mode: "HTML" })
    );
  } catch (err) {
    logger.warn({ err, userId, orderId }, "Não foi possível notificar o cliente sobre o envio");
  }
}
