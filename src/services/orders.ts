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
    userId,
    itemId,
    quantity,
    unitPriceCents,
    totalCents,
    paymentMethod
  );
  return (await findOrderById(result.lastID as number)) as Order;
}

export async function findOrderById(id: number): Promise<Order | undefined> {
  const db = await getDb();
  return db.get<Order>("SELECT * FROM orders WHERE id = ?", id);
}

export async function findOrderByMpPaymentId(
  mpPaymentId: string
): Promise<Order | undefined> {
  const db = await getDb();
  return db.get<Order>("SELECT * FROM orders WHERE mp_payment_id = ?", mpPaymentId);
}

export async function markOrderAsPaid(
  orderId: number,
  mpPaymentId: string
): Promise<void> {
  const db = await getDb();
  await db.run(
    "UPDATE orders SET status = 'paid', mp_payment_id = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ?",
    mpPaymentId,
    orderId
  );
}
