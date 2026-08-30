import { Router, Request, Response } from "express";
import { Telegraf } from "telegraf";
import { config } from "../../config/env";
import { MyContext } from "../../domain/types";
import { childLogger } from "../../infra/logger";
import { withTransaction } from "../../infra/db/pool";
import { claimWebhookEvent } from "../../repositories/webhooks.repo";
import { getPaymentDetails, validateMercadoPagoSignature } from "../../services/payments.service";
import { confirmOrderPayment, cancelPendingOrder } from "../../services/checkout.service";
import { findOrderWithItems } from "../../repositories/orders.repo";
import { findUserById } from "../../repositories/users.repo";
import { throttler } from "../../infra/telegram/throttler";
import { formatPrice } from "../../domain/money";
import { bold, esc } from "../../bot/ui/format";
import { formatSnapshotAddress } from "../../services/checkout.service";
import { formatCpf } from "../../domain/cpf";

interface WebhookBody {
  type?: string;
  action?: string;
  data?: { id?: string | number };
}

export function mercadoPagoRouter(bot: Telegraf<MyContext>): Router {
  const router = Router();

  router.post("/", async (req: Request, res: Response) => {
    const log = childLogger({ route: "mercadopago-webhook" });

    // Responde imediatamente: o Mercado Pago reenvia se demorarmos.
    const signature = req.header("x-signature");
    const requestId = req.header("x-request-id");
    const dataIdFromQuery =
      typeof req.query["data.id"] === "string" ? req.query["data.id"] : undefined;

    let body: WebhookBody = {};
    try {
      body = Buffer.isBuffer(req.body)
        ? (JSON.parse(req.body.toString("utf8")) as WebhookBody)
        : ((req.body ?? {}) as WebhookBody);
    } catch {
      log.warn("Corpo do webhook não é JSON válido");
      res.sendStatus(400);
      return;
    }

    const dataId = dataIdFromQuery ?? (body.data?.id ? String(body.data.id) : undefined);

    if (!validateMercadoPagoSignature(signature, requestId, dataId)) {
      log.warn({ dataId }, "Assinatura do webhook inválida");
      res.sendStatus(401);
      return;
    }

    res.sendStatus(200);

    const eventType = body.type ?? body.action ?? "";
    if (!dataId || !eventType.includes("payment")) return;

    try {
      await processPaymentNotification(bot, dataId, requestId);
    } catch (err) {
      log.error({ err, dataId }, "Falha ao processar notificação de pagamento");
    }
  });

  return router;
}

async function processPaymentNotification(
  bot: Telegraf<MyContext>,
  paymentId: string,
  requestId: string | undefined
): Promise<void> {
  const log = childLogger({ paymentId, requestId });

  // Idempotência: cada notificação é processada uma única vez.
  const isNew = await withTransaction((tx) =>
    claimWebhookEvent(tx, "mercadopago", `${paymentId}:${requestId ?? "na"}`)
  );
  if (!isNew) {
    log.debug("Notificação já processada anteriormente");
    return;
  }

  const payment = await getPaymentDetails(paymentId);
  if (!payment) {
    log.warn("Pagamento não encontrado no Mercado Pago");
    return;
  }

  const orderId = Number(payment.externalReference);
  if (!Number.isFinite(orderId)) {
    log.warn({ externalReference: payment.externalReference }, "Referência externa inválida");
    return;
  }

  log.info({ orderId, status: payment.status }, "Notificação de pagamento recebida");

  if (payment.status === "approved") {
    const result = await confirmOrderPayment(orderId, paymentId);
    if (!result || result.alreadyPaid) return;
    await notifyPaymentApproved(bot, orderId);
    return;
  }

  if (payment.status === "cancelled" || payment.status === "rejected") {
    await cancelPendingOrder(orderId, "cancelled");
    await notifyPaymentFailed(bot, orderId, payment.status);
  }
}

async function notifyPaymentApproved(bot: Telegraf<MyContext>, orderId: number): Promise<void> {
  const order = await findOrderWithItems(orderId);
  if (!order) return;

  const user = await findUserById(order.user_id);
  const items = order.items
    .map(
      (item) =>
        `• ${esc(item.item_title)}` +
        (item.variant_name !== "Padrão" ? ` (${esc(item.variant_name)})` : "") +
        ` — ${item.quantity}x`
    )
    .join("\n");

  const customerText =
    `${bold("Pagamento confirmado!")}\n\n` +
    `Pedido #${order.id}\n${items}\n\n` +
    `Total pago: ${bold(formatPrice(order.total_cents))}\n\n` +
    `Já estamos preparando seu envio. Você receberá o código de rastreio por aqui.`;

  await throttler
    .schedule(order.user_id, () =>
      bot.telegram.sendMessage(order.user_id, customerText, { parse_mode: "HTML" })
    )
    .catch(() => undefined);

  const snapshot = order.shipping_snapshot;
  const adminText =
    `${bold("Novo pedido pago")}\n\n` +
    `Pedido #${order.id}\n${items}\n\n` +
    `Total: ${bold(formatPrice(order.total_cents))}\n` +
    (order.shipping_cents > 0 ? `Frete: ${formatPrice(order.shipping_cents)}\n` : "") +
    (order.coupon_code ? `Cupom: ${esc(order.coupon_code)}\n` : "") +
    `\n${bold("Entrega")}\n` +
    `${esc(snapshot?.name ?? user?.name ?? "-")}\n` +
    `CPF: ${esc(formatCpf(snapshot?.cpf ?? user?.cpf ?? ""))}\n` +
    (snapshot?.phone ? `Telefone: ${esc(snapshot.phone)}\n` : "") +
    `${esc(formatSnapshotAddress(snapshot))}`;

  for (const chatId of [...config.admin.chatIds, config.admin.shippingGroupChatId]) {
    await throttler
      .schedule(chatId, () => bot.telegram.sendMessage(chatId, adminText, { parse_mode: "HTML" }))
      .catch(() => undefined);
  }
}

async function notifyPaymentFailed(
  bot: Telegraf<MyContext>,
  orderId: number,
  status: string
): Promise<void> {
  const order = await findOrderWithItems(orderId);
  if (!order) return;

  const reason = status === "rejected" ? "recusado" : "cancelado";
  const text =
    `${bold("Pagamento não concluído")}\n\n` +
    `O pagamento do pedido #${order.id} foi ${esc(reason)}.\n\n` +
    `Os itens voltaram para o estoque. Você pode tentar novamente pelo catálogo.`;

  await throttler
    .schedule(order.user_id, () =>
      bot.telegram.sendMessage(order.user_id, text, { parse_mode: "HTML" })
    )
    .catch(() => undefined);
}
