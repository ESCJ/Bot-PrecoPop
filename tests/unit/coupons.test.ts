import { describe, expect, it } from "vitest";
import { evaluateCoupon, describeCoupon } from "../../src/services/coupons.service";
import { Coupon } from "../../src/domain/types";

function coupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 1,
    code: "TESTE",
    kind: "percent",
    value: 10,
    min_order_cents: 0,
    max_uses: null,
    used_count: 0,
    starts_at: null,
    expires_at: null,
    active: true,
    ...overrides,
  };
}

describe("Regras de cupom", () => {
  it("aplica desconto percentual", () => {
    const result = evaluateCoupon(coupon({ kind: "percent", value: 10 }), 10_000);
    expect(result.valid).toBe(true);
    expect(result.discountCents).toBe(1_000);
    expect(result.freeShipping).toBe(false);
  });

  it("aplica desconto de valor fixo", () => {
    const result = evaluateCoupon(coupon({ kind: "fixed", value: 1_500 }), 10_000);
    expect(result.valid).toBe(true);
    expect(result.discountCents).toBe(1_500);
  });

  it("nunca deixa o desconto ultrapassar o subtotal", () => {
    const result = evaluateCoupon(coupon({ kind: "fixed", value: 50_000 }), 10_000);
    expect(result.valid).toBe(true);
    expect(result.discountCents).toBe(10_000);
  });

  it("sinaliza frete grátis sem gerar desconto no subtotal", () => {
    const result = evaluateCoupon(coupon({ kind: "free_shipping", value: 0 }), 10_000);
    expect(result.valid).toBe(true);
    expect(result.discountCents).toBe(0);
    expect(result.freeShipping).toBe(true);
  });

  it("rejeita cupom inexistente ou inativo", () => {
    expect(evaluateCoupon(null, 10_000).valid).toBe(false);
    expect(evaluateCoupon(coupon({ active: false }), 10_000).valid).toBe(false);
  });

  it("rejeita cupom expirado ou fora da janela", () => {
    const past = new Date("2020-01-01");
    const future = new Date("2999-01-01");

    expect(evaluateCoupon(coupon({ expires_at: past }), 10_000).valid).toBe(false);
    expect(evaluateCoupon(coupon({ starts_at: future }), 10_000).valid).toBe(false);
  });

  it("rejeita cupom que atingiu o limite de usos", () => {
    const result = evaluateCoupon(coupon({ max_uses: 5, used_count: 5 }), 10_000);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/limite/i);
  });

  it("respeita o valor mínimo do pedido", () => {
    const result = evaluateCoupon(coupon({ min_order_cents: 20_000 }), 10_000);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/mínimo/i);
  });

  it("descreve o benefício em linguagem natural", () => {
    expect(describeCoupon(coupon({ kind: "percent", value: 10 }))).toBe("10% de desconto");
    expect(describeCoupon(coupon({ kind: "fixed", value: 1_500 }))).toBe("R$ 15,00 de desconto");
    expect(describeCoupon(coupon({ kind: "free_shipping" }))).toBe("frete grátis");
  });
});
