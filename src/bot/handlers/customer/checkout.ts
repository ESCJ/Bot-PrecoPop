import { Composer, Markup } from "telegraf";
import { config } from "../../../config/env";
import { MyContext, OrderWithItems, PaymentMethod } from "../../../domain/types";
import { formatPrice } from "../../../domain/money";
import { ValidationError } from "../../../domain/errors";
import { logger } from "../../../infra/logger";
import { assertCartIsFulfillable, getCartTotals } from "../../../services/cart.service";
import { cancelPendingOrder, createOrderFromCart } from "../../../services/checkout.service";
import { createCheckoutCharge, createPixCharge } from "../../../services/payments.service";
import { attachPaymentId, findOrderWithItems } from "../../../repositories/orders.repo";
import { bold, code, esc, formatDate } from "../../ui/format";
import { CB, btn, cb, cbArgs, rows } from "../../ui/keyboards";
import { ack, render, send } from "../../ui/reply";
import { renderCart, renderOrder } from "../../ui/views";
import { showCart } from "./cart";

export const checkoutHandlers = new Composer<MyContext>();

const METHOD_BUTTONS: { method: PaymentMethod; label: string }[] = [
  { method: "pix", label: "Pix (aprovação imediata)" },
  { method: "credit_card", label: "Cartão de crédito" },
  { method: "debit_card", label: "Cartão de débito" },
  { method: "boleto", label: "Boleto bancário" },
];

checkoutHandlers.action(CB.checkout, async (ctx) => {
  await ack(ctx);
  if (!ctx.dbUser) return;

  const totals = await getCartTotals(ctx.dbUser);

  try {
    assertCartIsFulfillable(totals);
  } catch (err) {
    const reason = err instanceof ValidationError ? err.userMessage : "Revise seu carrinho.";
    await ack(ctx, reason);
    return showCart(ctx);
  }

  if (!ctx.dbUser.state || !ctx.dbUser.zip_code) {
    await render(
      ctx,
      `${bold("Endereço incompleto")}\n\n` +
        `Precisamos do seu endereço completo para calcular o frete e enviar o pedido.`,
      Markup.inlineKeyboard([
        [btn.cb("Atualizar meus dados", CB.profile)],
        [btn.cb("‹ Voltar ao carrinho", CB.cartOpen)],
      ])
    );
    return;
  }

  const keyboard = Markup.inlineKeyboard(
    rows(...METHOD_BUTTONS.map((entry) => [btn.cb(entry.label, cb(CB.payMethod, entry.method))]), [
      btn.cb("‹ Voltar ao carrinho", CB.cartOpen),
    ])
  );

  await render(ctx, `${renderCart(totals)}\n\n${bold("Como você quer pagar?")}`, keyboard);
});

checkoutHandlers.action(
  new RegExp(`^${CB.payMethod}:(pix|credit_card|debit_card|boleto)$`),
  async (ctx) => {
    await ack(ctx, "Gerando seu pagamento...");
    if (!ctx.dbUser) return;

    const [method] = cbArgs(ctx.match[0], CB.payMethod) as [PaymentMethod];

    // Se estoque, cupom ou preço mudaram, o erro sobe para o error-boundary
    // e o carrinho permanece intacto para o cliente ajustar.
    const order: OrderWithItems = await createOrderFromCart(ctx.dbUser, method);

    try {
      if (method === "pix") {
        const charge = await createPixCharge(order, ctx.dbUser);
        await attachPaymentId(order.id, charge.paymentId, charge.ticketUrl);

        await send(
          ctx,
          `${bold(`Pedido #${order.id} criado`)}\n\n` +
            `Valor: ${bold(formatPrice(order.total_cents))}\n` +
            `Pague até: ${esc(formatDate(order.expires_at))}\n\n` +
            `Copie o código Pix abaixo e pague no seu banco:`
        );

        await send(ctx, code(charge.qrCode));

        await render(
          ctx,
          `Assim que o pagamento for confirmado, você receberá a confirmação aqui automaticamente.\n\n` +
            `O estoque está reservado por ${config.checkout.pixTtlMinutes} minutos.`,
          Markup.inlineKeyboard(
            rows(
              charge.ticketUrl ? [btn.url("Abrir no Mercado Pago", charge.ticketUrl)] : [],
              [btn.cb("Cancelar pedido", cb(CB.orderCancel, order.id))],
              [btn.cb("‹ Menu principal", CB.menu)]
            )
          )
        );
        return;
      }

      const charge = await createCheckoutCharge(order, ctx.dbUser, method);
      await attachPaymentId(order.id, charge.preferenceId, charge.initPoint);

      await render(
        ctx,
        `${bold(`Pedido #${order.id} criado`)}\n\n` +
          `Valor: ${bold(formatPrice(order.total_cents))}\n` +
          `Pague até: ${esc(formatDate(order.expires_at))}\n\n` +
          `Toque no botão abaixo para concluir o pagamento com segurança no Mercado Pago.`,
        Markup.inlineKeyboard(
          rows(
            [btn.url("Pagar agora", charge.initPoint)],
            [btn.cb("Cancelar pedido", cb(CB.orderCancel, order.id))],
            [btn.cb("‹ Menu principal", CB.menu)]
          )
        )
      );
    } catch (err) {
      // Falha ao gerar a cobrança: devolve o estoque reservado imediatamente.
      logger.error({ err, orderId: order.id }, "Falha ao gerar cobrança; cancelando pedido");
      await cancelPendingOrder(order.id, "cancelled").catch(() => undefined);
      throw err;
    }
  }
);

checkoutHandlers.action(new RegExp(`^${CB.orderCancel}:(\\d+)$`), async (ctx) => {
  if (!ctx.dbUser) return ack(ctx);

  const [orderIdRaw] = cbArgs(ctx.match[0], CB.orderCancel);
  const orderId = Number(orderIdRaw);

  const order = await findOrderWithItems(orderId);
  if (!order || order.user_id !== ctx.dbUser.id) {
    return ack(ctx, "Pedido não encontrado.");
  }
  if (order.status !== "pending") {
    return ack(ctx, "Este pedido não pode mais ser cancelado.");
  }

  await cancelPendingOrder(orderId, "cancelled");
  await ack(ctx, "Pedido cancelado.");

  const updated = await findOrderWithItems(orderId);
  await render(
    ctx,
    updated ? `${renderOrder(updated)}\n\nO estoque foi liberado.` : "Pedido cancelado.",
    Markup.inlineKeyboard([
      [btn.cb("Ver catálogo", CB.catalog)],
      [btn.cb("‹ Menu principal", CB.menu)],
    ])
  );
});
