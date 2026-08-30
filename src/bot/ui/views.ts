import {
  CartTotals,
  CustomerSummary,
  OrderWithItems,
  User,
  VariantWithItem,
} from "../../domain/types";
import { formatPrice } from "../../domain/money";
import { formatCpf } from "../../domain/cpf";
import { formatAddress, formatCep } from "../../domain/cep";
import { describeShipping } from "../../services/shipping.service";
import { formatSnapshotAddress } from "../../services/checkout.service";
import { bold, code, esc, formatDate, methodLabel, statusLabel } from "./format";

export function renderCart(totals: CartTotals): string {
  if (totals.lines.length === 0) {
    return `${bold("Seu carrinho está vazio")}\n\nExplore o catálogo e adicione produtos.`;
  }

  const lines = totals.lines.map((line, index) => {
    const warning =
      line.quantity > line.available ? `\n   ⚠️ apenas ${line.available} disponível(is)` : "";
    return (
      `${index + 1}. ${bold(line.item_title)}` +
      (line.variant_name !== "Padrão" ? ` — ${esc(line.variant_name)}` : "") +
      `\n   ${line.quantity} × ${formatPrice(line.unit_price_cents)} = ` +
      `${bold(formatPrice(line.line_total_cents))}${warning}`
    );
  });

  const summary = [
    `Subtotal: ${formatPrice(totals.subtotal_cents)}`,
    totals.discount_cents > 0
      ? `Desconto${totals.coupon ? ` (${esc(totals.coupon.code)})` : ""}: -${formatPrice(totals.discount_cents)}`
      : null,
    `Frete: ${totals.shipping?.free ? "Grátis" : formatPrice(totals.shipping_cents)}`,
    totals.shipping ? `Prazo: ${esc(describeShipping(totals.shipping))}` : null,
    `${bold("Total")}: ${bold(formatPrice(totals.total_cents))}`,
  ].filter(Boolean);

  return `${bold("Seu carrinho")}\n\n${lines.join("\n\n")}\n\n${summary.join("\n")}`;
}

export function renderVariant(variant: VariantWithItem): string {
  const availability =
    variant.available > 0 ? `${variant.available} unidade(s) disponível(is)` : "Esgotado";

  return (
    `${bold(variant.item_title)}\n` +
    (variant.name !== "Padrão" ? `Opção: ${esc(variant.name)}\n` : "") +
    `\n${esc(variant.item_description)}\n\n` +
    `Preço: ${bold(formatPrice(variant.effective_price_cents))}\n` +
    `Estoque: ${esc(availability)}`
  );
}

export function renderOrder(order: OrderWithItems, forAdmin = false): string {
  const items = order.items
    .map(
      (item) =>
        `• ${esc(item.item_title)}` +
        (item.variant_name !== "Padrão" ? ` (${esc(item.variant_name)})` : "") +
        ` — ${item.quantity} × ${formatPrice(item.unit_price_cents)}`
    )
    .join("\n");

  const totals = [
    `Subtotal: ${formatPrice(order.subtotal_cents)}`,
    order.discount_cents > 0
      ? `Desconto${order.coupon_code ? ` (${esc(order.coupon_code)})` : ""}: -${formatPrice(order.discount_cents)}`
      : null,
    `Frete: ${order.shipping_cents === 0 ? "Grátis" : formatPrice(order.shipping_cents)}`,
    `${bold("Total")}: ${bold(formatPrice(order.total_cents))}`,
  ].filter(Boolean);

  const shipping = order.shipping_snapshot;
  const tracking = order.tracking_code
    ? `\n\n📦 Código de rastreio: ${code(order.tracking_code)}`
    : order.shipped
      ? "\n\n📦 Pedido enviado"
      : "";

  const adminBlock =
    forAdmin && shipping
      ? `\n\n${bold("Entrega")}\n${esc(shipping.name)} — ${esc(formatCpf(shipping.cpf))}` +
        (shipping.phone ? `\nTelefone: ${esc(shipping.phone)}` : "") +
        `\n${esc(formatSnapshotAddress(shipping))}`
      : "";

  const expiry =
    order.status === "pending" && order.expires_at
      ? `\nPagar até: ${esc(formatDate(order.expires_at))}`
      : "";

  return (
    `${bold(`Pedido #${order.id}`)}\n` +
    `Status: ${esc(statusLabel(order.status))}\n` +
    `Pagamento: ${esc(methodLabel(order.payment_method))}\n` +
    `Data: ${esc(formatDate(order.created_at))}${expiry}\n\n` +
    `${items}\n\n${totals.join("\n")}${tracking}${adminBlock}`
  );
}

export function renderOrderSummaryLine(order: OrderWithItems): string {
  const first = order.items[0];
  const extra = order.items.length > 1 ? ` +${order.items.length - 1}` : "";
  const label = first ? `${first.item_title}${extra}` : `Pedido #${order.id}`;
  return `#${order.id} · ${label} · ${formatPrice(order.total_cents)} · ${statusLabel(order.status)}`;
}

export function renderProfile(user: User): string {
  const address = formatAddress({
    street: user.street,
    number: user.number,
    complement: user.complement,
    neighborhood: user.neighborhood,
    city: user.city,
    state: user.state,
  });

  return (
    `${bold("Meus dados")}\n\n` +
    `Nome: ${esc(user.name)}\n` +
    `CPF: ${esc(formatCpf(user.cpf))}\n` +
    (user.phone ? `Telefone: ${esc(user.phone)}\n` : "") +
    `CEP: ${esc(formatCep(user.zip_code))}\n` +
    `Endereço: ${esc(address || "não informado")}`
  );
}

/* ---------------------------------------------------------------- */
/* Painel administrativo de clientes                                 */
/* ---------------------------------------------------------------- */

/** Rótulo curto de uma linha da lista de clientes. */
export function renderCustomerListLine(customer: CustomerSummary): string {
  const marks = [customer.banned_at ? "⛔" : null, customer.blocked_bot ? "🔕" : null]
    .filter(Boolean)
    .join("");
  const spent =
    customer.paid_orders_count > 0
      ? `${customer.paid_orders_count}× · ${formatPrice(customer.total_spent_cents)}`
      : "sem compras";
  return `${marks}${marks ? " " : ""}${customer.name} · ${spent}`;
}

export function renderCustomerCard(customer: CustomerSummary): string {
  const address = formatAddress({
    street: customer.street,
    number: customer.number,
    complement: customer.complement,
    neighborhood: customer.neighborhood,
    city: customer.city,
    state: customer.state,
  });

  const status = customer.banned_at
    ? `⛔ Suspenso desde ${esc(formatDate(customer.banned_at))}`
    : "✅ Ativo";

  // Os dois estados coexistem e significam coisas diferentes: um é decisão do
  // administrador, o outro é o cliente tendo bloqueado o bot no Telegram.
  const reachability = customer.blocked_bot ? "\n🔕 O cliente bloqueou o bot" : "";

  return (
    `${bold(customer.name)}\n` +
    `${status}${reachability}\n\n` +
    `ID Telegram: ${code(customer.id)}\n` +
    `CPF: ${esc(formatCpf(customer.cpf))}\n` +
    (customer.phone ? `Telefone: ${esc(customer.phone)}\n` : "") +
    `CEP: ${esc(formatCep(customer.zip_code))}\n` +
    `Endereço: ${esc(address || "não informado")}\n` +
    `Cadastro: ${esc(formatDate(customer.created_at))}\n\n` +
    `${bold("Compras")}\n` +
    `Pedidos: ${customer.orders_count} (${customer.paid_orders_count} pago(s))\n` +
    `Total pago: ${bold(formatPrice(customer.total_spent_cents))}\n` +
    `Último pedido: ${esc(formatDate(customer.last_order_at))}`
  );
}

export function renderPaymentHistory(
  customer: CustomerSummary,
  orders: OrderWithItems[],
  page: number,
  totalPages: number
): string {
  const header =
    `${bold(`Histórico de pagamentos`)}\n${esc(customer.name)}\n\n` +
    `Pedidos pagos: ${customer.paid_orders_count}\n` +
    `Valor total: ${bold(formatPrice(customer.total_spent_cents))}`;

  if (orders.length === 0) {
    return `${header}\n\nEste cliente ainda não tem pagamentos confirmados.`;
  }

  const blocks = orders.map((order) => {
    const items = order.items
      .map(
        (item) =>
          `   • ${esc(item.item_title)}` +
          (item.variant_name !== "Padrão" ? ` (${esc(item.variant_name)})` : "") +
          ` — ${item.quantity} × ${formatPrice(item.unit_price_cents)} = ` +
          `${formatPrice(item.total_cents)}`
      )
      .join("\n");

    const extras = [
      order.discount_cents > 0 ? `desconto ${formatPrice(order.discount_cents)}` : null,
      order.shipping_cents > 0 ? `frete ${formatPrice(order.shipping_cents)}` : null,
    ].filter(Boolean);

    return (
      `${bold(`#${order.id}`)} · ${esc(formatDate(order.paid_at ?? order.created_at))} · ` +
      `${esc(methodLabel(order.payment_method))}\n${items}\n` +
      `   ${bold(`Total: ${formatPrice(order.total_cents)}`)}` +
      (extras.length > 0 ? ` (${esc(extras.join(", "))})` : "")
    );
  });

  const footer = totalPages > 1 ? `\n\nPágina ${page} de ${totalPages}` : "";
  return `${header}\n\n${blocks.join("\n\n")}${footer}`;
}
