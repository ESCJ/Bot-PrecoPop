import { Composer, Markup } from "telegraf";
import { MyContext } from "../../../domain/types";
import { formatPrice } from "../../../domain/money";
import { CustomerFilter } from "../../../repositories/users.repo";
import {
  getCustomer,
  getCustomersPage,
  getPaymentHistory,
  removeCustomer,
  setCustomerBanned,
} from "../../../services/customers.service";
import { bold, esc } from "../../ui/format";
import { CB, btn, cb, cbArgs, paginationRow, rows } from "../../ui/keyboards";
import { ack, render } from "../../ui/reply";
import { renderCustomerCard, renderCustomerListLine, renderPaymentHistory } from "../../ui/views";

export const adminCustomersHandlers = new Composer<MyContext>();

const PAGE_SIZE = 5;
const HISTORY_PAGE_SIZE = 5;

const FILTERS: { key: CustomerFilter; label: string; empty: string }[] = [
  { key: "all", label: "Todos", empty: "Nenhum cliente cadastrado ainda." },
  { key: "buyers", label: "Compradores", empty: "Nenhum cliente com compra paga." },
  { key: "banned", label: "Suspensos", empty: "Nenhum cliente suspenso." },
];

function parseFilter(value: string | undefined): CustomerFilter {
  return FILTERS.some((f) => f.key === value) ? (value as CustomerFilter) : "all";
}

function filterTabs(active: CustomerFilter) {
  return FILTERS.map((filter) =>
    btn.cb(
      filter.key === active ? `• ${filter.label}` : filter.label,
      cb(CB.adminCustomersPage, filter.key, 1)
    )
  );
}

async function showCustomersPage(
  ctx: MyContext,
  filter: CustomerFilter,
  page: number
): Promise<void> {
  const result = await getCustomersPage(filter, page, PAGE_SIZE);
  const meta = FILTERS.find((f) => f.key === filter)!;

  const header =
    `${bold("Clientes")}\n\n` +
    (result.total === 0
      ? meta.empty
      : `${result.total} cliente(s) em "${esc(meta.label.toLowerCase())}".`);

  const customerRows = result.rows.map((customer) => [
    btn.cb(renderCustomerListLine(customer).slice(0, 60), cb(CB.adminCustomerView, customer.id)),
  ]);

  await render(
    ctx,
    header,
    Markup.inlineKeyboard(
      rows(
        filterTabs(filter),
        ...customerRows,
        // O filtro viaja junto no prefixo para a paginação não perdê-lo.
        paginationRow(cb(CB.adminCustomersPage, filter), result.page, result.totalPages),
        [btn.cb("‹ Painel", CB.admin)]
      )
    )
  );
}

async function showCustomer(ctx: MyContext, id: number): Promise<void> {
  const customer = await getCustomer(id);

  await render(
    ctx,
    renderCustomerCard(customer),
    Markup.inlineKeyboard(
      rows(
        [btn.cb("Histórico de pagamentos", cb(CB.adminCustomerHistory, id, 1))],
        customer.banned_at
          ? [btn.cb("Reativar acesso", cb(CB.adminCustomerUnban, id))]
          : [btn.cb("Bloquear cliente", cb(CB.adminCustomerBan, id))],
        [btn.cb("Remover cadastro", cb(CB.adminCustomerDelete, id))],
        [btn.cb("‹ Clientes", cb(CB.adminCustomersPage, "all", 1)), btn.cb("Painel", CB.admin)]
      )
    )
  );
}

adminCustomersHandlers.action(CB.adminCustomers, async (ctx) => {
  await ack(ctx);
  await showCustomersPage(ctx, "all", 1);
});

adminCustomersHandlers.action(
  new RegExp(`^${CB.adminCustomersPage}:(all|buyers|banned):(\\d+)$`),
  async (ctx) => {
    await ack(ctx);
    const [filter, page] = cbArgs(ctx.match[0], CB.adminCustomersPage);
    await showCustomersPage(ctx, parseFilter(filter), Number(page) || 1);
  }
);

adminCustomersHandlers.action(new RegExp(`^${CB.adminCustomerView}:(\\d+)$`), async (ctx) => {
  await ack(ctx);
  const [id] = cbArgs(ctx.match[0], CB.adminCustomerView);
  await showCustomer(ctx, Number(id));
});

/* ------------------------------------------------------------------ */
/* Histórico de pagamentos                                             */
/* ------------------------------------------------------------------ */

adminCustomersHandlers.action(
  new RegExp(`^${CB.adminCustomerHistory}:(\\d+):(\\d+)$`),
  async (ctx) => {
    await ack(ctx);
    const [idRaw, pageRaw] = cbArgs(ctx.match[0], CB.adminCustomerHistory);
    const id = Number(idRaw);

    const [customer, history] = await Promise.all([
      getCustomer(id),
      getPaymentHistory(id, Number(pageRaw) || 1, HISTORY_PAGE_SIZE),
    ]);

    await render(
      ctx,
      renderPaymentHistory(customer, history.rows, history.page, history.totalPages),
      Markup.inlineKeyboard(
        rows(
          paginationRow(cb(CB.adminCustomerHistory, id), history.page, history.totalPages),
          [btn.cb("‹ Cliente", cb(CB.adminCustomerView, id))],
          [btn.cb("Painel", CB.admin)]
        )
      )
    );
  }
);

/* ------------------------------------------------------------------ */
/* Bloquear e reativar                                                 */
/* ------------------------------------------------------------------ */

adminCustomersHandlers.action(new RegExp(`^${CB.adminCustomerBan}:(\\d+)$`), async (ctx) => {
  const [id] = cbArgs(ctx.match[0], CB.adminCustomerBan);
  await setCustomerBanned(Number(id), true);
  await ack(ctx, "Cliente bloqueado.");
  await showCustomer(ctx, Number(id));
});

adminCustomersHandlers.action(new RegExp(`^${CB.adminCustomerUnban}:(\\d+)$`), async (ctx) => {
  const [id] = cbArgs(ctx.match[0], CB.adminCustomerUnban);
  await setCustomerBanned(Number(id), false);
  await ack(ctx, "Acesso reativado.");
  await showCustomer(ctx, Number(id));
});

/* ------------------------------------------------------------------ */
/* Remoção (confirmação em duas etapas)                                */
/* ------------------------------------------------------------------ */

adminCustomersHandlers.action(new RegExp(`^${CB.adminCustomerDelete}:(\\d+)$`), async (ctx) => {
  await ack(ctx);
  const [idRaw] = cbArgs(ctx.match[0], CB.adminCustomerDelete);
  const id = Number(idRaw);
  const customer = await getCustomer(id);

  // A tela diz exatamente o que vai acontecer com este cliente, para o
  // administrador não descobrir depois que os pedidos ficaram para trás.
  const consequences = [
    "• O cadastro, o carrinho e a sessão serão apagados.",
    "• Pedidos pendentes serão cancelados e o estoque devolvido.",
    customer.paid_orders_count > 0
      ? `• Os ${customer.paid_orders_count} pedido(s) pago(s) (${formatPrice(customer.total_spent_cents)}) permanecem nos relatórios.`
      : null,
    "• O cliente poderá se cadastrar de novo enviando /start.",
  ].filter(Boolean);

  await render(
    ctx,
    `${bold("Remover cliente")}\n\n${esc(customer.name)}\n\n${consequences.join("\n")}\n\n` +
      `Confirma a remoção?`,
    Markup.inlineKeyboard(
      rows(
        [btn.cb("Sim, remover", cb(CB.adminCustomerDeleteYes, id))],
        [btn.cb("Cancelar", cb(CB.adminCustomerView, id))]
      )
    )
  );
});

adminCustomersHandlers.action(new RegExp(`^${CB.adminCustomerDeleteYes}:(\\d+)$`), async (ctx) => {
  const [idRaw] = cbArgs(ctx.match[0], CB.adminCustomerDeleteYes);
  const id = Number(idRaw);

  const customer = await getCustomer(id);
  const result = await removeCustomer(id);

  await ack(ctx, "Cliente removido.");
  await render(
    ctx,
    `${bold("Cliente removido")}\n\n${esc(customer.name)}\n\n` +
      `Pedidos pendentes cancelados: ${result.releasedOrders}\n` +
      `Pedidos pagos preservados: ${result.keptPaidOrders}`,
    Markup.inlineKeyboard(
      rows(
        [btn.cb("‹ Clientes", cb(CB.adminCustomersPage, "all", 1))],
        [btn.cb("Painel", CB.admin)]
      )
    )
  );
});
