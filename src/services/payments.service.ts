import { MercadoPagoConfig, Payment, Preference } from "mercadopago";
import { config, notificationUrl } from "../config/env";
import { logger } from "../infra/logger";
import { PaymentError } from "../domain/errors";
import { OrderWithItems, User } from "../domain/types";
import { onlyDigits } from "../domain/cpf";
import { verifyMercadoPagoSignature } from "../domain/signature";

const mpConfig = new MercadoPagoConfig({
  accessToken: config.mercadoPago.accessToken,
  options: { timeout: 15_000 },
});

const paymentClient = new Payment(mpConfig);
const preferenceClient = new Preference(mpConfig);

export interface PixCharge {
  paymentId: string;
  qrCode: string;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: string | null;
}

export interface CheckoutCharge {
  preferenceId: string;
  initPoint: string;
}

function payerFrom(user: User) {
  const [firstName, ...rest] = user.name.trim().split(/\s+/);
  return {
    email: `cliente${user.id}@precopop.bot`,
    first_name: firstName || user.name,
    last_name: rest.join(" ") || firstName || user.name,
    identification: { type: "CPF", number: onlyDigits(user.cpf) },
  };
}

function orderDescription(order: OrderWithItems): string {
  if (order.items.length === 1) {
    const item = order.items[0]!;
    return `${item.item_title}${item.quantity > 1 ? ` x${item.quantity}` : ""}`;
  }
  return `Pedido #${order.id} - ${order.items.length} itens`;
}

/** Cria uma cobrança Pix com QR Code e código copia-e-cola. */
export async function createPixCharge(order: OrderWithItems, user: User): Promise<PixCharge> {
  try {
    const response = (await paymentClient.create({
      body: {
        transaction_amount: Number((order.total_cents / 100).toFixed(2)),
        description: orderDescription(order),
        payment_method_id: "pix",
        payer: payerFrom(user),
        external_reference: String(order.id),
        notification_url: notificationUrl(),
        date_of_expiration: order.expires_at ? new Date(order.expires_at).toISOString() : undefined,
      },
      requestOptions: { idempotencyKey: `order-${order.id}-pix` },
    })) as unknown as Record<string, unknown>;

    const poi = response.point_of_interaction as
      { transaction_data?: Record<string, string> } | undefined;
    const transaction = poi?.transaction_data;

    if (!transaction?.qr_code) {
      throw new PaymentError(
        "Não foi possível gerar o Pix agora. Tente novamente em instantes.",
        "Resposta do Mercado Pago sem dados de Pix"
      );
    }

    return {
      paymentId: String(response.id),
      qrCode: transaction.qr_code,
      qrCodeBase64: transaction.qr_code_base64 ?? null,
      ticketUrl: transaction.ticket_url ?? null,
      expiresAt: (response.date_of_expiration as string | undefined) ?? null,
    };
  } catch (err) {
    if (err instanceof PaymentError) throw err;
    logger.error({ err, orderId: order.id }, "Falha ao criar cobrança Pix");
    throw new PaymentError("Não foi possível gerar o Pix agora. Tente novamente em instantes.");
  }
}

/** Cria uma preferência do Checkout Pro para cartão ou boleto. */
export async function createCheckoutCharge(
  order: OrderWithItems,
  user: User,
  method: "credit_card" | "debit_card" | "boleto"
): Promise<CheckoutCharge> {
  const excluded =
    method === "boleto"
      ? [{ id: "credit_card" }, { id: "debit_card" }]
      : [{ id: "ticket" }, { id: "bank_transfer" }];

  try {
    const response = (await preferenceClient.create({
      body: {
        items: order.items.map((item) => ({
          id: String(item.variant_id ?? item.item_id ?? item.id),
          title: `${item.item_title} (${item.variant_name})`.slice(0, 250),
          quantity: item.quantity,
          currency_id: "BRL",
          unit_price: Number((item.unit_price_cents / 100).toFixed(2)),
        })),
        // Frete e desconto entram como linhas próprias para o total bater.
        ...(order.shipping_cents > 0
          ? {
              shipments: {
                cost: Number((order.shipping_cents / 100).toFixed(2)),
                mode: "not_specified" as const,
              },
            }
          : {}),
        payer: payerFrom(user),
        external_reference: String(order.id),
        notification_url: notificationUrl(),
        statement_descriptor: "PRECOPOP",
        payment_methods: {
          excluded_payment_types: excluded,
          installments: method === "credit_card" ? 12 : 1,
        },
        back_urls: {
          success: `${config.server.publicUrl}/pagamento/sucesso`,
          failure: `${config.server.publicUrl}/pagamento/falha`,
          pending: `${config.server.publicUrl}/pagamento/pendente`,
        },
        auto_return: "approved",
        expires: true,
        expiration_date_to: order.expires_at ? new Date(order.expires_at).toISOString() : undefined,
      },
      requestOptions: { idempotencyKey: `order-${order.id}-${method}` },
    })) as unknown as Record<string, unknown>;

    const initPoint = (response.init_point ?? response.sandbox_init_point) as string | undefined;
    if (!initPoint) {
      throw new PaymentError("Não foi possível gerar o link de pagamento.");
    }

    return { preferenceId: String(response.id), initPoint };
  } catch (err) {
    if (err instanceof PaymentError) throw err;
    logger.error({ err, orderId: order.id, method }, "Falha ao criar preferência de pagamento");
    throw new PaymentError("Não foi possível gerar o link de pagamento. Tente novamente.");
  }
}

export interface PaymentDetails {
  id: string;
  status: string;
  externalReference: string | null;
}

export async function getPaymentDetails(paymentId: string): Promise<PaymentDetails | null> {
  try {
    const response = (await paymentClient.get({ id: paymentId })) as unknown as Record<
      string,
      unknown
    >;
    return {
      id: String(response.id),
      status: String(response.status ?? "unknown"),
      externalReference: (response.external_reference as string | undefined) ?? null,
    };
  } catch (err) {
    logger.error({ err, paymentId }, "Falha ao consultar pagamento no Mercado Pago");
    return null;
  }
}

/**
 * Valida a assinatura HMAC do webhook usando o segredo configurado.
 * A verificação em si vive em `domain/signature` e é testada isoladamente.
 */
export function validateMercadoPagoSignature(
  signatureHeader: string | undefined,
  requestId: string | undefined,
  dataId: string | undefined
): boolean {
  return verifyMercadoPagoSignature({
    signatureHeader,
    requestId,
    dataId,
    secret: config.mercadoPago.webhookSecret,
  });
}
