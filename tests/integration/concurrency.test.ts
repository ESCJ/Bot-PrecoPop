import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  closeDatabase,
  db,
  ensureSchema,
  resetData,
  seedProduct,
  seedUser,
  setShippingRate,
  variantStock,
  withTransaction,
} from "./helpers";
import { addVariantToCart, applyCouponByCode } from "../../src/services/cart.service";
import { createOrderFromCart } from "../../src/services/checkout.service";
import { createCoupon } from "../../src/repositories/coupons.repo";
import { claimWebhookEvent } from "../../src/repositories/webhooks.repo";

/** Executa promessas simultâneas e separa sucessos de falhas. */
async function settleAll<T>(tasks: Promise<T>[]) {
  const results = await Promise.allSettled(tasks);
  return {
    fulfilled: results.filter((r): r is PromiseFulfilledResult<T> => r.status === "fulfilled"),
    rejected: results.filter((r): r is PromiseRejectedResult => r.status === "rejected"),
  };
}

describe("Concorrência", () => {
  beforeAll(async () => {
    await ensureSchema();
    await setShippingRate("SP", 1990);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    await resetData();
  });

  it("não vende o último item para dois compradores simultâneos", async () => {
    const [buyerA, buyerB] = await Promise.all([
      seedUser({ state: "SP" }),
      seedUser({ state: "SP" }),
    ]);
    const { variant } = await seedProduct({ priceCents: 10_000, stock: 1 });

    await addVariantToCart(buyerA.id, variant.id, 1);
    await addVariantToCart(buyerB.id, variant.id, 1);

    const { fulfilled, rejected } = await settleAll([
      createOrderFromCart(buyerA, "pix"),
      createOrderFromCart(buyerB, "pix"),
    ]);

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0]!.reason)).toMatch(/esgot|disponív/i);

    // Exatamente uma unidade reservada — nunca duas.
    expect(await variantStock(variant.id)).toEqual({ stock: 1, reserved: 1 });

    const orders = await db.query("SELECT id FROM orders");
    expect(orders).toHaveLength(1);
  });

  it("respeita o estoque com dez compradores disputando três unidades", async () => {
    const buyers = await Promise.all(Array.from({ length: 10 }, () => seedUser({ state: "SP" })));
    const { variant } = await seedProduct({ priceCents: 5_000, stock: 3 });

    await Promise.all(buyers.map((buyer) => addVariantToCart(buyer.id, variant.id, 1)));

    const { fulfilled, rejected } = await settleAll(
      buyers.map((buyer) => createOrderFromCart(buyer, "pix"))
    );

    expect(fulfilled).toHaveLength(3);
    expect(rejected).toHaveLength(7);
    expect(await variantStock(variant.id)).toEqual({ stock: 3, reserved: 3 });
  });

  it("não deixa dois checkouts usarem o último uso de um cupom", async () => {
    const [buyerA, buyerB] = await Promise.all([
      seedUser({ state: "SP" }),
      seedUser({ state: "SP" }),
    ]);
    const { variant } = await seedProduct({ priceCents: 10_000, stock: 10 });

    const coupon = await createCoupon({
      code: "UNICO",
      kind: "fixed",
      value: 1_000,
      minOrderCents: 0,
      maxUses: 1,
      expiresAt: null,
      createdBy: 1,
    });

    await addVariantToCart(buyerA.id, variant.id, 1);
    await addVariantToCart(buyerB.id, variant.id, 1);
    await applyCouponByCode(buyerA, "UNICO");
    await applyCouponByCode(buyerB, "UNICO");

    const { fulfilled, rejected } = await settleAll([
      createOrderFromCart(buyerA, "pix"),
      createOrderFromCart(buyerB, "pix"),
    ]);

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0]!.reason)).toMatch(/cupom/i);

    const row = await db.queryOne<{ used_count: number }>(
      "SELECT used_count FROM coupons WHERE id = $1",
      [coupon.id]
    );
    expect(row!.used_count).toBe(1);
  });

  it("processa o mesmo evento de webhook apenas uma vez", async () => {
    const claim = () =>
      withTransaction((tx) => claimWebhookEvent(tx, "mercadopago", "evento-duplicado"));

    expect(await claim()).toBe(true);
    expect(await claim()).toBe(false);
    expect(await claim()).toBe(false);

    const rows = await db.query("SELECT id FROM processed_webhooks WHERE event_id = $1", [
      "evento-duplicado",
    ]);
    expect(rows).toHaveLength(1);
  });

  it("garante idempotência mesmo com entregas simultâneas do provedor", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        withTransaction((tx) => claimWebhookEvent(tx, "mercadopago", "evento-paralelo"))
      )
    );

    const claimed = results.filter(
      (result) => result.status === "fulfilled" && result.value === true
    );
    expect(claimed).toHaveLength(1);
  });

  it("separa eventos por provedor", async () => {
    await withTransaction((tx) => claimWebhookEvent(tx, "mercadopago", "evt-1"));
    const other = await withTransaction((tx) => claimWebhookEvent(tx, "telegram", "evt-1"));
    expect(other).toBe(true);
  });
});
