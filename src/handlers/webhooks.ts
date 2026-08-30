import { Router } from "express";
import { Telegraf } from "telegraf";
import crypto from "crypto";
import { config } from "../config";
import { MyContext } from "../types";
import { getPaymentStatus } from "../services/payments";
import {
  findOrderById,
  markOrderAsPaid,
} from "../services/orders";
import { decrementStock, findItemById, formatPrice } from "../services/items";
import { findUserById, formatCpf } from "../services/users";
import { notifyAdmin, notifyShippingGroup } from "./admin";

export function createWebhookRouter(bot: Telegraf<MyContext>): Router {
  const router = Router();

  router.post("/mercadopago", async (req, res) => {
    res.status(200).send("OK");

    try {
      const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body);
      const body = JSON.parse(rawBody);

      const signature = req.headers["x-signature"] as string;
      const requestId = req.headers["x-request-id"] as string;

      if (!signature) {
        console.warn("Webhook MP rejeitado: assinatura ausente");
        return;
      }

      if (!validateMercadoPagoSignature(body, signature, requestId)) {
        console.warn("Webhook MP rejeitado: assinatura inválida");
        return;
      }

      const topic = body.topic || body.type;
      const paymentId = body.data?.id || body.id;

      if (topic !== "payment" || !paymentId) {
        console.log("Webhook MP ignorado:", { topic, paymentId });
        return;
      }

      const status = await getPaymentStatus(String(paymentId));
      if (status !== "approved") {
        console.log(`Pagamento ${paymentId} não aprovado. Status: ${status}`);
        return;
      }

      const { Payment: MpPayment } = await import("mercadopago");
      const paymentClient = new MpPayment({
        accessToken: config.mercadoPago.accessToken,
        options: { timeout: 15000 },
      });
      const paymentData = (await paymentClient.get({ id: String(paymentId) })) as any;
      const externalReference = paymentData.external_reference;

      if (!externalReference) {
        console.warn("Pagamento sem external_reference:", paymentId);
        return;
      }

      const orderId = parseInt(externalReference, 10);
      const order = await findOrderById(orderId);
      if (!order) {
        console.warn("Pedido não encontrado:", orderId);
        return;
      }

      if (order.status === "paid") {
        console.log(`Pedido ${order.id} já está pago.`);
        return;
      }

      await markOrderAsPaid(order.id, String(paymentId));
      await decrementStock(order.item_id, order.quantity);

      const item = await findItemById(order.item_id);
      const user = await findUserById(order.user_id);

      const adminMessage =
        `🛒 *NOVA VENDA CONFIRMADA*\n\n` +
        `Pedido: #${order.id}\n` +
        `Cliente: ${user?.name || "N/A"}\n` +
        `CPF: ${user ? formatCpf(user.cpf) : "N/A"}\n` +
        `Endereço: ${user?.address || "N/A"}\n` +
        `CEP: ${user?.zip_code || "N/A"}\n\n` +
        `Item: ${item?.title || "N/A"}\n` +
        `Quantidade: ${order.quantity}\n` +
        `Valor total: ${formatPrice(order.total_cents)}\n` +
        `Pagamento: ${formatPaymentMethod(order.payment_method)}\n` +
        `ID Mercado Pago: ${paymentId}`;

      const shippingMessage =
        `📦 *PEDIDO PARA ENVIO*\n\n` +
        `Pedido: #${order.id}\n` +
        `Cliente: ${user?.name || "N/A"}\n` +
        `Telefone/Contato: ${user?.id || "N/A"}\n` +
        `Endereço: ${user?.address || "N/A"}\n` +
        `CEP: ${user?.zip_code || "N/A"}\n\n` +
        `Item: ${item?.title || "N/A"}\n` +
        `Quantidade: ${order.quantity}\n` +
        `Valor total: ${formatPrice(order.total_cents)}\n\n` +
        `✅ Marque como enviado no painel admin.`;

      try {
        await bot.telegram.sendMessage(config.admin.chatId, adminMessage, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "📦 Marcar como Enviado",
                  callback_data: `ship:${order.id}`,
                },
              ],
            ],
          },
        });
        await bot.telegram.sendMessage(config.admin.shippingGroupChatId, shippingMessage, {
          parse_mode: "Markdown",
        });
        await bot.telegram.sendMessage(
          order.user_id,
          `✅ *Pagamento confirmado!*\n\nSeu pedido *#${order.id}* foi aprovado e será preparado para envio em breve.\n\nAgradecemos a preferência! 🛍️`,
          { parse_mode: "Markdown" }
        );
      } catch (err) {
        console.error("Erro ao enviar notificações:", err);
      }
    } catch (err) {
      console.error("Erro ao processar webhook do Mercado Pago:", err);
    }
  });

  return router;
}

function validateMercadoPagoSignature(
  body: any,
  signature: string,
  requestId: string
): boolean {
  try {
    const parts = signature.split(",");
    const tsPart = parts.find((p) => p.startsWith("ts="));
    const hashPart = parts.find((p) => p.startsWith("v1="));

    if (!tsPart || !hashPart) return false;

    const ts = tsPart.replace("ts=", "");
    const receivedHash = hashPart.replace("v1=", "");
    const dataId = body.data?.id || "";

    const template = `id:${dataId};request-id:${requestId};ts:${ts},`;
    const secret = config.mercadoPago.webhookSecret;
    const calculatedHash = crypto
      .createHmac("sha256", secret)
      .update(template)
      .digest("hex");

    return crypto.timingSafeEqual(
      Buffer.from(receivedHash, "hex"),
      Buffer.from(calculatedHash, "hex")
    );
  } catch {
    return false;
  }
}

function formatPaymentMethod(method: string): string {
  const map: Record<string, string> = {
    pix: "Pix",
    credit_card: "Cartão de Crédito",
    debit_card: "Cartão de Débito",
    boleto: "Boleto",
  };
  return map[method] || method;
}
