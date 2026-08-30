import { db, Queryable } from "../infra/db/pool";
import { Coupon } from "../domain/types";

const COLUMNS = `id, code, kind, value, min_order_cents, max_uses, used_count,
                 starts_at, expires_at, active`;

export async function findCouponByCode(
  code: string,
  runner: Queryable = db
): Promise<Coupon | undefined> {
  return runner.queryOne<Coupon>(`SELECT ${COLUMNS} FROM coupons WHERE UPPER(code) = UPPER($1)`, [
    code.trim(),
  ]);
}

export async function findCouponById(
  id: number,
  runner: Queryable = db
): Promise<Coupon | undefined> {
  return runner.queryOne<Coupon>(`SELECT ${COLUMNS} FROM coupons WHERE id = $1`, [id]);
}

export async function listCoupons(): Promise<Coupon[]> {
  return db.query<Coupon>(`SELECT ${COLUMNS} FROM coupons ORDER BY active DESC, created_at DESC`);
}

export interface CreateCouponInput {
  code: string;
  kind: Coupon["kind"];
  value: number;
  minOrderCents: number;
  maxUses: number | null;
  expiresAt: Date | null;
  createdBy: number;
}

export async function createCoupon(input: CreateCouponInput): Promise<Coupon> {
  const row = await db.queryOne<Coupon>(
    `INSERT INTO coupons (code, kind, value, min_order_cents, max_uses, expires_at, created_by)
     VALUES (UPPER($1), $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNS}`,
    [
      input.code.trim(),
      input.kind,
      input.value,
      input.minOrderCents,
      input.maxUses,
      input.expiresAt,
      input.createdBy,
    ]
  );
  return row!;
}

export async function setCouponActive(id: number, active: boolean): Promise<void> {
  await db.execute("UPDATE coupons SET active = $2, updated_at = NOW() WHERE id = $1", [
    id,
    active,
  ]);
}

export async function deleteCoupon(id: number): Promise<void> {
  await db.execute("DELETE FROM coupons WHERE id = $1", [id]);
}

/**
 * Incrementa o uso respeitando o limite máximo de forma atômica.
 * Retorna false quando o cupom já esgotou — evita corrida entre dois checkouts.
 */
export async function consumeCoupon(tx: Queryable, id: number): Promise<boolean> {
  const affected = await tx.execute(
    `UPDATE coupons
        SET used_count = used_count + 1, updated_at = NOW()
      WHERE id = $1 AND active
        AND (max_uses IS NULL OR used_count < max_uses)`,
    [id]
  );
  return affected > 0;
}

export async function refundCouponUse(tx: Queryable, id: number): Promise<void> {
  await tx.execute(
    "UPDATE coupons SET used_count = GREATEST(used_count - 1, 0), updated_at = NOW() WHERE id = $1",
    [id]
  );
}
