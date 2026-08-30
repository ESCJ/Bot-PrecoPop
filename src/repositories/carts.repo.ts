import { db, Queryable } from "../infra/db/pool";
import { CartLine } from "../domain/types";

export async function getOrCreateCartId(userId: number, runner: Queryable = db): Promise<number> {
  const row = await runner.queryOne<{ id: number }>(
    `INSERT INTO carts (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [userId]
  );
  return row!.id;
}

export async function listCartLines(userId: number, runner: Queryable = db): Promise<CartLine[]> {
  return runner.query<CartLine>(
    `SELECT ci.id                                       AS cart_item_id,
            ci.variant_id,
            v.item_id,
            i.title                                     AS item_title,
            v.name                                      AS variant_name,
            i.photo_file_id,
            COALESCE(v.price_cents, i.price_cents)::INT AS unit_price_cents,
            ci.quantity,
            (v.stock - v.reserved)::INT                 AS available,
            (COALESCE(v.price_cents, i.price_cents) * ci.quantity)::INT AS line_total_cents
       FROM cart_items ci
       JOIN carts c          ON c.id = ci.cart_id
       JOIN item_variants v  ON v.id = ci.variant_id
       JOIN items i          ON i.id = v.item_id
      WHERE c.user_id = $1
      ORDER BY ci.id`,
    [userId]
  );
}

export async function addToCart(
  userId: number,
  variantId: number,
  quantity: number
): Promise<void> {
  const cartId = await getOrCreateCartId(userId);
  await db.execute(
    `INSERT INTO cart_items (cart_id, variant_id, quantity)
     VALUES ($1, $2, $3)
     ON CONFLICT (cart_id, variant_id)
     DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity, updated_at = NOW()`,
    [cartId, variantId, quantity]
  );
}

export async function setCartItemQuantity(
  userId: number,
  cartItemId: number,
  quantity: number
): Promise<void> {
  if (quantity <= 0) {
    await removeCartItem(userId, cartItemId);
    return;
  }
  await db.execute(
    `UPDATE cart_items ci
        SET quantity = $3, updated_at = NOW()
       FROM carts c
      WHERE ci.cart_id = c.id AND c.user_id = $1 AND ci.id = $2`,
    [userId, cartItemId, quantity]
  );
}

export async function removeCartItem(userId: number, cartItemId: number): Promise<void> {
  await db.execute(
    `DELETE FROM cart_items ci
      USING carts c
      WHERE ci.cart_id = c.id AND c.user_id = $1 AND ci.id = $2`,
    [userId, cartItemId]
  );
}

export async function clearCart(userId: number, runner: Queryable = db): Promise<void> {
  await runner.execute(
    `DELETE FROM cart_items ci USING carts c WHERE ci.cart_id = c.id AND c.user_id = $1`,
    [userId]
  );
  await runner.execute("UPDATE carts SET coupon_id = NULL, updated_at = NOW() WHERE user_id = $1", [
    userId,
  ]);
}

export async function setCartCoupon(userId: number, couponId: number | null): Promise<void> {
  await getOrCreateCartId(userId);
  await db.execute("UPDATE carts SET coupon_id = $2, updated_at = NOW() WHERE user_id = $1", [
    userId,
    couponId,
  ]);
}

export async function getCartCouponId(
  userId: number,
  runner: Queryable = db
): Promise<number | null> {
  const row = await runner.queryOne<{ coupon_id: number | null }>(
    "SELECT coupon_id FROM carts WHERE user_id = $1",
    [userId]
  );
  return row?.coupon_id ?? null;
}

export async function countCartItems(userId: number): Promise<number> {
  const row = await db.queryOne<{ total: string }>(
    `SELECT COALESCE(SUM(ci.quantity), 0)::TEXT AS total
       FROM cart_items ci JOIN carts c ON c.id = ci.cart_id
      WHERE c.user_id = $1`,
    [userId]
  );
  return Number(row?.total ?? 0);
}
