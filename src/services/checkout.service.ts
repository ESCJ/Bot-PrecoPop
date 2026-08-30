import { config } from "../config/env";
import { withTransaction, Queryable, db } from "../infra/db/pool";
import { logger } from "../infra/logger";
import { ConflictError, OutOfStockError, ValidationError } from "../domain/errors";
import { Order, OrderWithItems, PaymentMethod, ShippingSnapshot, User } from "../domain/types";
import { formatAddress } from "../domain/cep";
import { commitStock, lockVariants, releaseStock, reserveStock } from "../repositories/items.repo";
import { consumeCoupon, refundCouponUse } from "../repositories/coupons.repo";
import {
  findExpiredPendingOrderIds,
  insertOrder,
  insertOrderItems,
  listOrderItems,
  lockOrderById,
  markOrderCancelled,
  markOrderPaid,
} from "../repositories/orders.repo";
import { clearCart } from "../repositories/carts.repo";
import { getCartTotals, assertCartIsFulfillable } from "./cart.service";

function buildShippingSnapshot(user: User, daysMin?: number, daysMax?: number): ShippingSnapshot {
  return {
    name: user.name,
    cpf: user.cpf,
    phone: user.phone,
    zip_code: user.zip_code,
    street: user.street,
    number: user.number,
    complement: user.complement,
    neighborhood: user.neighborhood,
    city: user.city,
    state: user.state,
    days_min: daysMin,
    days_max: daysMax,
  };
}

export function formatSnapshotAddress(snapshot: ShippingSnapshot | null): string {
  if (!snapshot) return "Endereço não informado";
  return formatAddress({
    street: snapshot.street,
    number: snapshot.number,
    complement: snapshot.complement,
    neighborhood: snapshot.neighborhood,
    city: snapshot.city,
    state: snapshot.state,
    zipCode: snapshot.zip_code,
  });
}

/**
 * Cria o pedido dentro de uma única transação:
 * trava as variações, revalida disponibilidade, reserva o estoque,
 * consome o cupom e esvazia o carrinho. Qualquer falha desfaz tudo.
 */
export async function createOrderFromCart(
  user: User,
  paymentMethod: PaymentMethod
): Promise<OrderWithItems> {
  const totals = await getCartTotals(user);
  assertCartIsFulfillable(totals);

  if (!user.state || !user.zip_code) {
    throw new ValidationError("Complete seu endereço antes de finalizar a compra.");
  }

  const expiresAt = new Date(Date.now() + config.checkout.pixTtlMinutes * 60_000);

  return withTransaction(async (tx) => {
    const variantIds = totals.lines.map((line) => line.variant_id);
    const locked = await lockVariants(tx, variantIds);

    // Revalida com o estoque travado — impede venda dupla do último item.
    for (const line of totals.lines) {
      const variant = locked.get(line.variant_id);
      if (!variant || !variant.active || !variant.item_active) {
        throw new OutOfStockError(`"${line.item_title}" não está mais disponível.`);
      }
      if (variant.available < line.quantity) {
        throw new OutOfStockError(
          variant.available > 0
            ? `"${line.item_title}" tem apenas ${variant.available} unidade(s) disponível(is).`
            : `"${line.item_title}" esgotou enquanto você finalizava a compra.`
        );
      }
      if (variant.effective_price_cents !== line.unit_price_cents) {
        throw new ConflictError(
          `O preço de "${line.item_title}" mudou. Revise o carrinho e tente novamente.`
        );
      }
    }

    if (totals.coupon) {
      const consumed = await consumeCoupon(tx, totals.coupon.id);
      if (!consumed) {
        throw new ConflictError("O cupom aplicado acabou de esgotar.");
      }
    }

    const order = await insertOrder(tx, {
      userId: user.id,
      subtotalCents: totals.subtotal_cents,
      discountCents: totals.discount_cents,
      shippingCents: totals.shipping_cents,
      totalCents: totals.total_cents,
      couponId: totals.coupon?.id ?? null,
      couponCode: totals.coupon?.code ?? null,
      paymentMethod,
      shippingSnapshot: buildShippingSnapshot(
        user,
        totals.shipping?.days_min,
        totals.shipping?.days_max
      ),
      expiresAt,
    });

    await insertOrderItems(
      tx,
      order.id,
      totals.lines.map((line) => ({
        variantId: line.variant_id,
        itemId: line.item_id,
        itemTitle: line.item_title,
        variantName: line.variant_name,
        unitPriceCents: line.unit_price_cents,
        quantity: line.quantity,
      }))
    );

    for (const line of totals.lines) {
      await reserveStock(tx, line.variant_id, line.quantity);
    }

    await clearCart(user.id, tx);

    const items = await listOrderItems(order.id, tx);
    return { ...order, items };
  });
}

/**
 * Confirma o pagamento: baixa o estoque reservado e marca o pedido como pago.
 * É idempotente — chamadas repetidas para o mesmo pedido não têm efeito.
 */
export async function confirmOrderPayment(
  orderId: number,
  mpPaymentId: string
): Promise<{ order: Order; alreadyPaid: boolean } | null> {
  return withTransaction(async (tx) => {
    const order = await lockOrderById(tx, orderId);
    if (!order) return null;

    if (order.status === "paid") {
      return { order, alreadyPaid: true };
    }

    if (order.status === "cancelled" || order.status === "expired") {
      logger.warn({ orderId, status: order.status }, "Pagamento recebido para pedido encerrado");
    }

    const items = await listOrderItems(orderId, tx);
    const variantIds = items
      .map((item) => item.variant_id)
      .filter((id): id is number => id !== null);

    await lockVariants(tx, variantIds);

    for (const item of items) {
      if (item.variant_id === null) continue;
      if (order.stock_released) {
        // A reserva já havia expirado: baixa direto do estoque físico.
        await commitStockWithoutReservation(tx, item.variant_id, item.quantity);
      } else {
        await commitStock(tx, item.variant_id, item.quantity);
      }
    }

    await markOrderPaid(tx, orderId, mpPaymentId);

    const updated = await lockOrderById(tx, orderId);
    return { order: updated!, alreadyPaid: false };
  });
}

async function commitStockWithoutReservation(
  tx: Queryable,
  variantId: number,
  quantity: number
): Promise<void> {
  await tx.execute(
    "UPDATE item_variants SET stock = GREATEST(stock - $2, 0), updated_at = NOW() WHERE id = $1",
    [variantId, quantity]
  );
}

/** Cancela um pedido pendente devolvendo o estoque reservado e o uso do cupom. */
export async function cancelPendingOrder(
  orderId: number,
  status: "cancelled" | "expired"
): Promise<Order | null> {
  return withTransaction(async (tx) => {
    const order = await lockOrderById(tx, orderId);
    if (!order) return null;
    if (order.status !== "pending" || order.stock_released) return order;

    const items = await listOrderItems(orderId, tx);
    const variantIds = items
      .map((item) => item.variant_id)
      .filter((id): id is number => id !== null);

    await lockVariants(tx, variantIds);

    for (const item of items) {
      if (item.variant_id === null) continue;
      await releaseStock(tx, item.variant_id, item.quantity);
    }

    if (order.coupon_id) {
      await refundCouponUse(tx, order.coupon_id);
    }

    await markOrderCancelled(tx, orderId, status);
    return (await lockOrderById(tx, orderId)) ?? order;
  });
}

/**
 * Libera reservas de pedidos cuja janela de pagamento expirou.
 * Sem essa rotina o estoque reservado nunca voltaria para a vitrine.
 */
export async function releaseExpiredOrders(): Promise<number> {
  const ids = await findExpiredPendingOrderIds();
  let released = 0;

  for (const id of ids) {
    try {
      await cancelPendingOrder(id, "expired");
      released += 1;
    } catch (err) {
      logger.error({ err, orderId: id }, "Falha ao liberar reserva de pedido expirado");
    }
  }

  if (released > 0) {
    logger.info({ released }, "Reservas de estoque liberadas por expiração");
  }
  return released;
}

/** Pedidos pendentes do usuário que ainda podem ser pagos. */
export async function listPayableOrders(userId: number): Promise<Order[]> {
  return db.query<Order>(
    `SELECT * FROM orders
      WHERE user_id = $1 AND status = 'pending' AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC`,
    [userId]
  );
}
