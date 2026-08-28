import { Router } from "express";
import { Telegraf } from "telegraf";
import { config } from "../config";
import { MyContext } from "../types";
import { getPaymentStatus } from "../services/payments";
import { findOrderById, markOrderAsPaid } from "../services/orders";
import { decrementStock, findItemById, formatPrice } from "../services/items";
import { findUserById, formatCpf } from "../services/users";
import { notifyAdmin, notifyShippingGroup } from "./admin";

export function createWebhookRouter(bot: Telegraf<MyContext>): Router {
  const router = Router();

  router.post("/mercadopago", async (req, res) => {
    // Responde rapidamente ao Mercado Pago
    res.status(200).send("OK");

    try {
      const body = req.body;
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

      // Para pagamentos via Payment (Pix), já temos o ID do pagamento.
      // Para pagamentos via Preference (cartão/boleto), associamos pelo external_reference
      // quando o webhook chegar. A API do MP em payment.get retorna external_reference.
      // Vamos buscar pelo external_reference aqui.
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
        `Pagamento: ${order.payment_method}`;

      const shippingMessage =
        `📦 *PEDIDO PARA ENVIO*\n\n` +
        `Pedido: #${order.id}\n` +
        `Cliente: ${user?.name || "N/A"}\n` +
        `Endereço: ${user?.address || "N/A"}\n` +
        `CEP: ${user?.zip_code || "N/A"}\n\n` +
        `Item: ${item?.title || "N/A"}\n` +
        `Quantidade: ${order.quantity}\n` +
        `Valor total: ${formatPrice(order.total_cents)}`;

      try {
        await bot.telegram.sendMessage(config.admin.chatId, adminMessage, {
          parse_mode: "Markdown",
        });
        await bot.telegram.sendMessage(config.admin.shippingGroupChatId, shippingMessage, {
          parse_mode: "Markdown",
        });
        await bot.telegram.sendMessage(
          order.user_id,
          `✅ Pagamento confirmado! Seu pedido #${order.id} foi aprovado e será enviado em breve.`,
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
