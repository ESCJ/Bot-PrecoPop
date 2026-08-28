import { MercadoPagoConfig, Payment, Preference } from "mercadopago";
import { config } from "../config";
import { Order, Item, User, PaymentMethod } from "../types";

const mpConfig = new MercadoPagoConfig({
  accessToken: config.mercadoPago.accessToken,
  options: { timeout: 15000 },
});

const paymentClient = new Payment(mpConfig);
const preferenceClient = new Preference(mpConfig);

export interface PixPaymentResult {
  paymentId: string;
  qrCode: string;
  qrCodeBase64: string;
  checkoutUrl: string;
}

export interface CheckoutPreferenceResult {
  preferenceId: string;
  initPoint: string;
}

export async function createPixPayment(
  order: Order,
  item: Item,
  user: User
): Promise<PixPaymentResult> {
  const response = await paymentClient.create({
    body: {
      transaction_amount: order.total_cents / 100,
      description: `${item.title} x${order.quantity}`,
      payment_method_id: "pix",
      payer: {
        email: `${user.id}@telegram.bot`,
        first_name: user.name.split(" ")[0] || user.name,
        last_name: user.name.split(" ").slice(1).join(" ") || "-",
        identification: { type: "CPF", number: user.cpf.replace(/\D/g, "") },
      },
      external_reference: String(order.id),
      notification_url: `${config.server.publicUrl}/webhooks/mercadopago`,
    },
  });

  const data = response as any;
  const transactionData = data.point_of_interaction?.transaction_data;
  if (!transactionData) {
    throw new Error("Resposta do Mercado Pago não contém dados Pix");
  }

  return {
    paymentId: String(data.id),
    qrCode: transactionData.qr_code,
    qrCodeBase64: transactionData.qr_code_base64,
    checkoutUrl: transactionData.ticket_url,
  };
}

export async function createCheckoutPreference(
  order: Order,
  item: Item,
  user: User
): Promise<CheckoutPreferenceResult> {
  const response = await preferenceClient.create({
    body: {
      items: [
        {
          id: String(item.id),
          title: item.title,
          description: item.description,
          quantity: order.quantity,
          currency_id: "BRL",
          unit_price: order.unit_price_cents / 100,
        },
      ],
      payer: {
        email: `${user.id}@telegram.bot`,
        name: user.name,
        identification: { type: "CPF", number: user.cpf.replace(/\D/g, "") },
      },
      external_reference: String(order.id),
      notification_url: `${config.server.publicUrl}/webhooks/mercadopago`,
      back_urls: {
        success: `${config.server.publicUrl}/payment/success`,
        failure: `${config.server.publicUrl}/payment/failure`,
        pending: `${config.server.publicUrl}/payment/pending`,
      },
      auto_return: "approved",
    },
  });

  const data = response as any;
  return {
    preferenceId: data.id,
    initPoint: data.init_point,
  };
}

export async function getPaymentStatus(paymentId: string): Promise<"approved" | "pending" | "other"> {
  const response = await paymentClient.get({ id: paymentId });
  const data = response as any;
  if (data.status === "approved") return "approved";
  if (data.status === "pending" || data.status === "in_process") return "pending";
  return "other";
}

export function buildNotificationUrl(publicBaseUrl: string): string {
  return `${publicBaseUrl}/webhooks/mercadopago`;
}
