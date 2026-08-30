import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  closeDatabase,
  db,
  ensureSchema,
  expireOrder,
  orderStatus,
  resetData,
  seedProduct,
  seedUser,
  setShippingRate,
  variantStock,
} from "./helpers";
import {
  addVariantToCart,
  applyCouponByCode,
  getCartTotals,
} from "../../src/services/cart.service";
import {
  cancelPendingOrder,
  confirmOrderPayment,
  createOrderFromCart,
  releaseExpiredOrders,
} from "../../src/services/checkout.service";
import { createCoupon } from "../../src/repositories/coupons.repo";
import { listCartLines } from "../../src/repositories/carts.repo";
import { OutOfStockError } from "../../src/domain/errors";

describe("Ciclo de vida do pedido", () => {
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

  it("reserva o estoque ao criar o pedido e o baixa ao confirmar o pagamento", async () => {
    const user = await seedUser({ state: "SP" });
    const { variant } = await seedProduct({ priceCents: 10_000, stock: 5 });

    await addVariantToCart(user.id, variant.id, 2);
    const order = await createOrderFromCart(user, "pix");

    expect(order.subtotal_cents).toBe(20_000);
    expect(order.shipping_cents).toBe(1990);
    expect(order.total_cents).toBe(21_990);
    expect(order.items).toHaveLength(1);
    expect(order.items[0]!.quantity).toBe(2);

    // Reservado, mas ainda não baixado: o item some da vitrine sem sumir do estoque.
    expect(await variantStock(variant.id)).toEqual({ stock: 5, reserved: 2 });

    // O carrinho é esvaziado dentro da mesma transação.
    expect(await listCartLines(user.id)).toHaveLength(0);

    const result = await confirmOrderPayment(order.id, "mp-1");
    expect(result?.alreadyPaid).toBe(false);
    expect(await variantStock(variant.id)).toEqual({ stock: 3, reserved: 0 });
    expect(await orderStatus(order.id)).toBe("paid");
  });

  it("congela endereço e preço no pedido", async () => {
    const user = await seedUser({ state: "SP" });
    const { variant } = await seedProduct({ priceCents: 7_500, stock: 3 });

    await addVariantToCart(user.id, variant.id, 1);
    const order = await createOrderFromCart(user, "pix");

    expect(order.shipping_snapshot?.city).toBe("São Paulo");
    expect(order.shipping_snapshot?.cpf).toBe(user.cpf);
    expect(order.items[0]!.unit_price_cents).toBe(7_500);

    // Mudar o preço do produto não altera o pedido já criado.
    await db.execute("UPDATE items SET price_cents = 9999");
    const items = await db.query<{ unit_price_cents: number }>(
      "SELECT unit_price_cents FROM order_items WHERE order_id = $1",
      [order.id]
    );
    expect(items[0]!.unit_price_cents).toBe(7_500);
  });

  it("confirmar o mesmo pagamento duas vezes não baixa o estoque em dobro", async () => {
    const user = await seedUser({ state: "SP" });
    const { variant } = await seedProduct({ priceCents: 5_000, stock: 4 });

    await addVariantToCart(user.id, variant.id, 1);
    const order = await createOrderFromCart(user, "pix");

    const first = await confirmOrderPayment(order.id, "mp-2");
    const second = await confirmOrderPayment(order.id, "mp-2");

    expect(first?.alreadyPaid).toBe(false);
    expect(second?.alreadyPaid).toBe(true);
    expect(await variantStock(variant.id)).toEqual({ stock: 3, reserved: 0 });
  });

  it("devolve o estoque quando o pedido expira", async () => {
    const user = await seedUser({ state: "SP" });
    const { variant } = await seedProduct({ priceCents: 5_000, stock: 2 });

    await addVariantToCart(user.id, variant.id, 2);
    const order = await createOrderFromCart(user, "pix");
    expect(await variantStock(variant.id)).toEqual({ stock: 2, reserved: 2 });

    await expireOrder(order.id);
    const released = await releaseExpiredOrders();

    expect(released).toBe(1);
    expect(await orderStatus(order.id)).toBe("expired");
    expect(await variantStock(variant.id)).toEqual({ stock: 2, reserved: 0 });
  });

  it("devolve o uso do cupom ao cancelar o pedido", async () => {
    const user = await seedUser({ state: "SP" });
    const { variant } = await seedProduct({ priceCents: 10_000, stock: 5 });

    const coupon = await createCoupon({
      code: "VOLTA10",
      kind: "percent",
      value: 10,
      minOrderCents: 0,
      maxUses: 3,
      expiresAt: null,
      createdBy: 1,
    });

    await addVariantToCart(user.id, variant.id, 1);
    await applyCouponByCode(user, "VOLTA10");

    const order = await createOrderFromCart(user, "pix");
    expect(order.discount_cents).toBe(1_000);

    let used = await db.queryOne<{ used_count: number }>(
      "SELECT used_count FROM coupons WHERE id = $1",
      [coupon.id]
    );
    expect(used!.used_count).toBe(1);

    await cancelPendingOrder(order.id, "cancelled");

    used = await db.queryOne<{ used_count: number }>(
      "SELECT used_count FROM coupons WHERE id = $1",
      [coupon.id]
    );
    expect(used!.used_count).toBe(0);
    expect(await variantStock(variant.id)).toEqual({ stock: 5, reserved: 0 });
  });

  it("baixa o estoque físico quando o pagamento chega após a reserva expirar", async () => {
    const user = await seedUser({ state: "SP" });
    const { variant } = await seedProduct({ priceCents: 5_000, stock: 3 });

    await addVariantToCart(user.id, variant.id, 1);
    const order = await createOrderFromCart(user, "pix");

    await expireOrder(order.id);
    await releaseExpiredOrders();
    expect(await variantStock(variant.id)).toEqual({ stock: 3, reserved: 0 });

    // Pagamento atrasado: baixa direto do estoque, sem reserva a consumir.
    await confirmOrderPayment(order.id, "mp-3");
    expect(await variantStock(variant.id)).toEqual({ stock: 2, reserved: 0 });
  });

  it("recusa o checkout quando o carrinho excede o disponível", async () => {
    const user = await seedUser({ state: "SP" });
    const { variant } = await seedProduct({ priceCents: 5_000, stock: 1 });

    await addVariantToCart(user.id, variant.id, 1);

    // Alguém reservou a última unidade entre a montagem do carrinho e o checkout.
    await db.execute("UPDATE item_variants SET reserved = 1 WHERE id = $1", [variant.id]);

    await expect(createOrderFromCart(user, "pix")).rejects.toThrow(/esgot|disponív/i);
  });

  it("aplica frete grátis acima do limite quando o cupom concede", async () => {
    const user = await seedUser({ state: "SP" });
    const { variant } = await seedProduct({ priceCents: 30_000, stock: 2 });

    await createCoupon({
      code: "FRETEGRATIS",
      kind: "free_shipping",
      value: 0,
      minOrderCents: 0,
      maxUses: null,
      expiresAt: null,
      createdBy: 1,
    });

    await addVariantToCart(user.id, variant.id, 1);
    await applyCouponByCode(user, "FRETEGRATIS");

    const totals = await getCartTotals(user);
    expect(totals.shipping_cents).toBe(0);
    expect(totals.total_cents).toBe(30_000);
  });

  it("propaga OutOfStockError como erro de domínio", async () => {
    const user = await seedUser({ state: "SP" });
    const { variant } = await seedProduct({ priceCents: 1_000, stock: 1 });

    await addVariantToCart(user.id, variant.id, 1);
    await db.execute("UPDATE item_variants SET active = FALSE WHERE id = $1", [variant.id]);

    await expect(createOrderFromCart(user, "pix")).rejects.toBeInstanceOf(OutOfStockError);
  });
});
