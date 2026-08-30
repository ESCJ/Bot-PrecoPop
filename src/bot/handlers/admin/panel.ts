import { Composer, Markup } from "telegraf";
import { MyContext } from "../../../domain/types";
import { formatPrice } from "../../../domain/money";
import { countUsers } from "../../../repositories/users.repo";
import {
  countOrdersAwaitingShipment,
  countOrdersByStatus,
  getSalesReport,
  getTopProducts,
} from "../../../repositories/orders.repo";
import { countAllItems } from "../../../repositories/items.repo";
import { bold, esc } from "../../ui/format";
import { CB, btn, cb, cbArgs, rows } from "../../ui/keyboards";
import { ack, render } from "../../ui/reply";

export const adminPanelHandlers = new Composer<MyContext>();

export async function showAdminPanel(ctx: MyContext): Promise<void> {
  const [items, pending, awaiting, users] = await Promise.all([
    countAllItems(),
    countOrdersByStatus("pending"),
    countOrdersAwaitingShipment(),
    countUsers(),
  ]);

  const text =
    `${bold("Painel do administrador")}\n\n` +
    `Produtos cadastrados: ${items}\n` +
    `Pedidos aguardando pagamento: ${pending}\n` +
    `Pedidos a enviar: ${awaiting}\n` +
    `Clientes: ${users.total} (${users.reachable} alcançáveis)`;

  const keyboard = Markup.inlineKeyboard(
    rows(
      [btn.cb("Novo produto", CB.adminNewItem)],
      [btn.cb("Gerenciar produtos", cb(CB.adminItemsPage, 1))],
      [btn.cb(`Pedidos a enviar (${awaiting})`, cb(CB.adminOrdersPage, 1))],
      [btn.cb("Cupons", CB.adminCoupons), btn.cb("Frete", CB.adminShipping)],
      [btn.cb("Enviar comunicado", CB.adminBroadcast)],
      [btn.cb("Relatórios", cb(CB.adminReportRange, 30))],
      [btn.cb("‹ Menu principal", CB.menu)]
    )
  );

  await render(ctx, text, keyboard);
}

adminPanelHandlers.action(CB.admin, async (ctx) => {
  await ack(ctx);
  await showAdminPanel(ctx);
});

adminPanelHandlers.command("admin", async (ctx) => {
  if (!ctx.isAdmin) return;
  await showAdminPanel(ctx);
});

/* ------------------------------------------------------------------ */
/* Relatórios                                                          */
/* ------------------------------------------------------------------ */

const RANGES: { days: number | null; label: string }[] = [
  { days: 7, label: "7 dias" },
  { days: 30, label: "30 dias" },
  { days: 90, label: "90 dias" },
  { days: null, label: "Tudo" },
];

adminPanelHandlers.action(new RegExp(`^${CB.adminReportRange}:(\\d+|all)$`), async (ctx) => {
  await ack(ctx);

  const [rangeRaw] = cbArgs(ctx.match[0], CB.adminReportRange);
  const days = rangeRaw === "all" ? null : Number(rangeRaw);

  const [report, top] = await Promise.all([getSalesReport(days), getTopProducts(5, days)]);

  const period = days ? `últimos ${days} dias` : "período completo";

  const topList =
    top.length > 0
      ? top
          .map(
            (product, index) =>
              `${index + 1}. ${esc(product.item_title)}` +
              (product.variant_name !== "Padrão" ? ` (${esc(product.variant_name)})` : "") +
              ` — ${product.units} un. · ${formatPrice(product.revenue_cents)}`
          )
          .join("\n")
      : "Nenhuma venda no período.";

  const text =
    `${bold("Relatório de vendas")}\n${esc(period)}\n\n` +
    `Pedidos pagos: ${report.paidOrders}\n` +
    `Aguardando pagamento: ${report.pendingOrders}\n` +
    `Cancelados/expirados: ${report.cancelledOrders}\n` +
    `A enviar: ${report.awaitingShipment}\n\n` +
    `Faturamento: ${bold(formatPrice(report.revenueCents))}\n` +
    `Frete arrecadado: ${formatPrice(report.shippingCents)}\n` +
    `Descontos concedidos: ${formatPrice(report.discountCents)}\n` +
    `Ticket médio: ${formatPrice(report.averageTicketCents)}\n\n` +
    `${bold("Mais vendidos")}\n${topList}`;

  const rangeButtons = RANGES.map((range) =>
    btn.cb(range.label, cb(CB.adminReportRange, range.days ?? "all"))
  );

  await render(
    ctx,
    text,
    Markup.inlineKeyboard(rows(rangeButtons, [btn.cb("‹ Painel", CB.admin)]))
  );
});
