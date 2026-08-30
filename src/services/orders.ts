import { getDb } from "../db";
import { Order, PaymentMethod } from "../types";

export async function createOrder(
  userId: number,
  itemId: number,
  quantity: number,
  unitPriceCents: number,
  paymentMethod: PaymentMethod
): Promise<Order> {
  const db = await getDb();
  const totalCents = unitPriceCents * quantity;
  const result = await db.run(
    "INSERT INTO orders (user_id, item_id, quantity, unit_price_cents, total_cents, payment_method) VALUES (?, ?, ?, ?, ?, ?)",
    [userId, itemId, quantity, unitPriceCents, totalCents, paymentMethod]
  );
  return (await findOrderById(result.lastID as number)) as Order;
}

export async function findOrderById(id: number): Promise<Order | undefined> {
  const db = await getDb();
  const rows = await db.query<Order>("SELECT * FROM orders WHERE id = ?", [id]);
  return rows[0];
}

export async function findOrderByMpPaymentId(
  mpPaymentId: string
): Promise<Order | undefined> {
  const db = await getDb();
  const rows = await db.query<Order>(
    "SELECT * FROM orders WHERE mp_payment_id = ?",
    [mpPaymentId]
  );
  return rows[0];
}

export async function findOrdersByUser(userId: number): Promise<Order[]> {
  const db = await getDb();
  return db.query<Order>(
    "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC",
    [userId]
  );
}

export async function markOrderAsPaid(
  orderId: number,
  mpPaymentId: string
): Promise<void> {
  const db = await getDb();
  await db.run(
    "UPDATE orders SET status = 'paid', mp_payment_id = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ?",
    [mpPaymentId, orderId]
  );
}

export async function markOrderAsShipped(orderId: number): Promise<void> {
  const db = await getDb();
  await db.run("UPDATE orders SET shipped = TRUE WHERE id = ?", [orderId]);
}

export async function getSalesReport(): Promise<{
  totalSales: number;
  totalRevenue: number;
  paidOrders: number;
  pendingOrders: number;
}> {
  const db = await getDb();
  const paid = await db.query<{ count: string; total: string }>(
    "SELECT COUNT(*) as count, COALESCE(SUM(total_cents), 0) as total FROM orders WHERE status = 'paid'"
  );
  const pending = await db.query<{ count: string }>(
    "SELECT COUNT(*) as count FROM orders WHERE status = 'pending'"
  );

  return {
    totalSales: parseInt(paid[0]?.count || "0", 10),
    totalRevenue: parseInt(paid[0]?.total || "0", 10),
    paidOrders: parseInt(paid[0]?.count || "0", 10),
    pendingOrders: parseInt(pending[0]?.count || "0", 10),
  };
}
