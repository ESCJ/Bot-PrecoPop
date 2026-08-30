import { Composer, Markup } from "telegraf";
import { MyContext } from "../../../domain/types";
import {
  countOrdersByUser,
  findOrderWithItems,
  listOrdersByUser,
} from "../../../repositories/orders.repo";
import { bold } from "../../ui/format";
import { CB, btn, cb, cbArgs, paginationRow, rows } from "../../ui/keyboards";
import { ack, render } from "../../ui/reply";
import { renderOrder, renderOrderSummaryLine } from "../../ui/views";

const PAGE_SIZE = 5;

export const ordersHandlers = new Composer<MyContext>();

async function showOrdersPage(ctx: MyContext, page: number): Promise<void> {
  if (!ctx.dbUser) return;

  const total = await countOrdersByUser(ctx.dbUser.id);

  if (total === 0) {
    await render(
      ctx,
      `${bold("Meus pedidos")}\n\nVocê ainda não fez nenhum pedido.`,
      Markup.inlineKeyboard([
        [btn.cb("Ver catálogo", CB.catalog)],
        [btn.cb("‹ Menu principal", CB.menu)],
      ])
    );
    return;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  ctx.session.ordersPage = safePage;

  const orders = await listOrdersByUser(ctx.dbUser.id, PAGE_SIZE, (safePage - 1) * PAGE_SIZE);

  const orderRows = orders.map((order) => [
    btn.cb(renderOrderSummaryLine(order).slice(0, 60), cb(CB.orderView, order.id)),
  ]);

  await render(
    ctx,
    `${bold("Meus pedidos")}\n\nVocê tem ${total} pedido(s). Toque para ver os detalhes.`,
    Markup.inlineKeyboard(
      rows(...orderRows, paginationRow(CB.ordersPage, safePage, totalPages), [
        btn.cb("‹ Menu principal", CB.menu),
      ])
    )
  );
}

ordersHandlers.action(new RegExp(`^${CB.ordersPage}:(\\d+)$`), async (ctx) => {
  await ack(ctx);
  const [page] = cbArgs(ctx.match[0], CB.ordersPage);
  await showOrdersPage(ctx, Number(page) || 1);
});

ordersHandlers.command("pedidos", async (ctx) => showOrdersPage(ctx, 1));

ordersHandlers.action(new RegExp(`^${CB.orderView}:(\\d+)$`), async (ctx) => {
  await ack(ctx);
  if (!ctx.dbUser) return;

  const [orderIdRaw] = cbArgs(ctx.match[0], CB.orderView);
  const order = await findOrderWithItems(Number(orderIdRaw));

  if (!order || order.user_id !== ctx.dbUser.id) {
    return ack(ctx, "Pedido não encontrado.");
  }

  const actions = rows(
    order.status === "pending" && order.checkout_url
      ? [btn.url("Pagar agora", order.checkout_url)]
      : [],
    order.status === "pending" ? [btn.cb("Cancelar pedido", cb(CB.orderCancel, order.id))] : [],
    [btn.cb("‹ Meus pedidos", cb(CB.ordersPage, ctx.session.ordersPage ?? 1))],
    [btn.cb("Menu principal", CB.menu)]
  );

  await render(ctx, renderOrder(order), Markup.inlineKeyboard(actions));
});
