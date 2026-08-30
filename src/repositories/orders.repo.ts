import { db, Queryable } from "../infra/db/pool";
import {
  Order,
  OrderItem,
  OrderStatus,
  OrderWithItems,
  PaymentMethod,
  ShippingSnapshot,
} from "../domain/types";

const ORDER_COLUMNS = `id, user_id, status, subtotal_cents, discount_cents, shipping_cents,
                       total_cents, coupon_id, coupon_code, payment_method, mp_payment_id,
                       checkout_url, shipping_snapshot, tracking_code, shipped, shipped_at,
                       paid_at, expires_at, cancelled_at, stock_committed, stock_released,
                       created_at, updated_at`;

const ORDER_ITEM_COLUMNS = `id, order_id, variant_id, item_id, item_title, variant_name,
                            unit_price_cents, quantity, total_cents`;

export interface CreateOrderInput {
  userId: number;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  couponId: number | null;
  couponCode: string | null;
  paymentMethod: PaymentMethod;
  shippingSnapshot: ShippingSnapshot;
  expiresAt: Date;
}

export interface CreateOrderItemInput {
  variantId: number;
  itemId: number;
  itemTitle: string;
  variantName: string;
  unitPriceCents: number;
  quantity: number;
}

export async function insertOrder(tx: Queryable, input: CreateOrderInput): Promise<Order> {
  const row = await tx.queryOne<Order>(
    `INSERT INTO orders (user_id, status, subtotal_cents, discount_cents, shipping_cents,
                         total_cents, coupon_id, coupon_code, payment_method,
                         shipping_snapshot, expires_at, updated_at)
     VALUES ($1, 'pending', $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, NOW())
     RETURNING ${ORDER_COLUMNS}`,
    [
      input.userId,
      input.subtotalCents,
      input.discountCents,
      input.shippingCents,
      input.totalCents,
      input.couponId,
      input.couponCode,
      input.paymentMethod,
      JSON.stringify(input.shippingSnapshot),
      input.expiresAt,
    ]
  );
  return row!;
}

export async function insertOrderItems(
  tx: Queryable,
  orderId: number,
  items: CreateOrderItemInput[]
): Promise<void> {
  for (const item of items) {
    await tx.execute(
      `INSERT INTO order_items (order_id, variant_id, item_id, item_title, variant_name,
                                unit_price_cents, quantity, total_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        orderId,
        item.variantId,
        item.itemId,
        item.itemTitle,
        item.variantName,
        item.unitPriceCents,
        item.quantity,
        item.unitPriceCents * item.quantity,
      ]
    );
  }
}

export async function findOrderById(
  id: number,
  runner: Queryable = db
): Promise<Order | undefined> {
  return runner.queryOne<Order>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1`, [id]);
}

/** Busca e trava o pedido — usado no webhook para evitar processamento duplicado. */
export async function lockOrderById(tx: Queryable, id: number): Promise<Order | undefined> {
  return tx.queryOne<Order>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1 FOR UPDATE`, [id]);
}

export async function listOrderItems(
  orderId: number,
  runner: Queryable = db
): Promise<OrderItem[]> {
  return runner.query<OrderItem>(
    `SELECT ${ORDER_ITEM_COLUMNS} FROM order_items WHERE order_id = $1 ORDER BY id`,
    [orderId]
  );
}

export async function findOrderWithItems(id: number): Promise<OrderWithItems | undefined> {
  const order = await findOrderById(id);
  if (!order) return undefined;
  return { ...order, items: await listOrderItems(id) };
}

export async function listOrdersByUser(
  userId: number,
  limit: number,
  offset: number
): Promise<OrderWithItems[]> {
  const orders = await db.query<Order>(
    `SELECT ${ORDER_COLUMNS} FROM orders
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return Promise.all(
    orders.map(async (order) => ({ ...order, items: await listOrderItems(order.id) }))
  );
}

export async function countOrdersByUser(userId: number): Promise<number> {
  const row = await db.queryOne<{ count: string }>(
    "SELECT COUNT(*)::TEXT AS count FROM orders WHERE user_id = $1",
    [userId]
  );
  return Number(row?.count ?? 0);
}

export async function listOrdersByStatus(
  status: OrderStatus,
  limit: number,
  offset: number
): Promise<OrderWithItems[]> {
  const orders = await db.query<Order>(
    `SELECT ${ORDER_COLUMNS} FROM orders
      WHERE status = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [status, limit, offset]
  );
  return Promise.all(
    orders.map(async (order) => ({ ...order, items: await listOrderItems(order.id) }))
  );
}

export async function countOrdersByStatus(status: OrderStatus): Promise<number> {
  const row = await db.queryOne<{ count: string }>(
    "SELECT COUNT(*)::TEXT AS count FROM orders WHERE status = $1",
    [status]
  );
  return Number(row?.count ?? 0);
}

/** Lista pedidos pagos aguardando envio. */
export async function listOrdersAwaitingShipment(
  limit: number,
  offset: number
): Promise<OrderWithItems[]> {
  const orders = await db.query<Order>(
    `SELECT ${ORDER_COLUMNS} FROM orders
      WHERE status = 'paid' AND NOT shipped
      ORDER BY paid_at ASC NULLS LAST, created_at ASC
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return Promise.all(
    orders.map(async (order) => ({ ...order, items: await listOrderItems(order.id) }))
  );
}

export async function countOrdersAwaitingShipment(): Promise<number> {
  const row = await db.queryOne<{ count: string }>(
    "SELECT COUNT(*)::TEXT AS count FROM orders WHERE status = 'paid' AND NOT shipped"
  );
  return Number(row?.count ?? 0);
}

export async function attachPaymentId(
  orderId: number,
  mpPaymentId: string,
  checkoutUrl: string | null
): Promise<void> {
  await db.execute(
    `UPDATE orders SET mp_payment_id = $2, checkout_url = COALESCE($3, checkout_url), updated_at = NOW()
      WHERE id = $1`,
    [orderId, mpPaymentId, checkoutUrl]
  );
}

export async function markOrderPaid(
  tx: Queryable,
  orderId: number,
  mpPaymentId: string
): Promise<void> {
  await tx.execute(
    `UPDATE orders
        SET status = 'paid', mp_payment_id = $2, paid_at = NOW(),
            stock_committed = TRUE, updated_at = NOW()
      WHERE id = $1`,
    [orderId, mpPaymentId]
  );
}

export async function markOrderCancelled(
  tx: Queryable,
  orderId: number,
  status: Extract<OrderStatus, "cancelled" | "expired">
): Promise<void> {
  await tx.execute(
    `UPDATE orders
        SET status = $2, cancelled_at = NOW(), stock_released = TRUE, updated_at = NOW()
      WHERE id = $1`,
    [orderId, status]
  );
}

export async function markStockReleased(tx: Queryable, orderId: number): Promise<void> {
  await tx.execute("UPDATE orders SET stock_released = TRUE, updated_at = NOW() WHERE id = $1", [
    orderId,
  ]);
}

export async function markOrderShipped(
  orderId: number,
  trackingCode: string | null
): Promise<void> {
  await db.execute(
    `UPDATE orders
        SET shipped = TRUE, shipped_at = NOW(), tracking_code = $2, updated_at = NOW()
      WHERE id = $1`,
    [orderId, trackingCode]
  );
}

/** Pedidos pendentes cuja janela de pagamento expirou e ainda seguram estoque. */
export async function findExpiredPendingOrderIds(limit = 50): Promise<number[]> {
  const rows = await db.query<{ id: number }>(
    `SELECT id FROM orders
      WHERE status = 'pending'
        AND NOT stock_released
        AND expires_at IS NOT NULL
        AND expires_at < NOW()
      ORDER BY expires_at
      LIMIT $1`,
    [limit]
  );
  return rows.map((row) => row.id);
}

export interface SalesReport {
  paidOrders: number;
  pendingOrders: number;
  cancelledOrders: number;
  revenueCents: number;
  shippingCents: number;
  discountCents: number;
  averageTicketCents: number;
  awaitingShipment: number;
}

export async function getSalesReport(sinceDays: number | null = null): Promise<SalesReport> {
  const filter = sinceDays ? "AND created_at >= NOW() - ($1 || ' days')::INTERVAL" : "";
  const params = sinceDays ? [sinceDays] : [];

  const row = await db.queryOne<Record<string, string>>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'paid')::TEXT                       AS paid_orders,
       COUNT(*) FILTER (WHERE status = 'pending')::TEXT                    AS pending_orders,
       COUNT(*) FILTER (WHERE status IN ('cancelled','expired'))::TEXT     AS cancelled_orders,
       COALESCE(SUM(total_cents)    FILTER (WHERE status = 'paid'), 0)::TEXT AS revenue_cents,
       COALESCE(SUM(shipping_cents) FILTER (WHERE status = 'paid'), 0)::TEXT AS shipping_cents,
       COALESCE(SUM(discount_cents) FILTER (WHERE status = 'paid'), 0)::TEXT AS discount_cents,
       COUNT(*) FILTER (WHERE status = 'paid' AND NOT shipped)::TEXT       AS awaiting_shipment
     FROM orders
     WHERE TRUE ${filter}`,
    params
  );

  const paidOrders = Number(row?.paid_orders ?? 0);
  const revenueCents = Number(row?.revenue_cents ?? 0);

  return {
    paidOrders,
    pendingOrders: Number(row?.pending_orders ?? 0),
    cancelledOrders: Number(row?.cancelled_orders ?? 0),
    revenueCents,
    shippingCents: Number(row?.shipping_cents ?? 0),
    discountCents: Number(row?.discount_cents ?? 0),
    averageTicketCents: paidOrders > 0 ? Math.round(revenueCents / paidOrders) : 0,
    awaitingShipment: Number(row?.awaiting_shipment ?? 0),
  };
}

export interface TopProduct {
  item_title: string;
  variant_name: string;
  units: number;
  revenue_cents: number;
}

export async function getTopProducts(
  limit = 5,
  sinceDays: number | null = null
): Promise<TopProduct[]> {
  const filter = sinceDays ? "AND o.created_at >= NOW() - ($2 || ' days')::INTERVAL" : "";
  const params: unknown[] = sinceDays ? [limit, sinceDays] : [limit];

  return db.query<TopProduct>(
    `SELECT oi.item_title,
            oi.variant_name,
            SUM(oi.quantity)::INT     AS units,
            SUM(oi.total_cents)::INT  AS revenue_cents
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE o.status = 'paid' ${filter}
      GROUP BY oi.item_title, oi.variant_name
      ORDER BY units DESC, revenue_cents DESC
      LIMIT $1`,
    params
  );
}
