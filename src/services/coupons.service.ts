import { Coupon } from "../domain/types";
import { percentOf } from "../domain/money";

export interface CouponEvaluation {
  valid: boolean;
  reason?: string;
  discountCents: number;
  freeShipping: boolean;
}

/**
 * Avalia um cupom contra o subtotal do carrinho.
 * Não altera estado — o consumo do cupom acontece no checkout, em transação.
 */
export function evaluateCoupon(
  coupon: Coupon | null | undefined,
  subtotalCents: number,
  now: Date = new Date()
): CouponEvaluation {
  const invalid = (reason: string): CouponEvaluation => ({
    valid: false,
    reason,
    discountCents: 0,
    freeShipping: false,
  });

  if (!coupon) return invalid("Cupom não encontrado.");
  if (!coupon.active) return invalid("Este cupom está inativo.");

  if (coupon.starts_at && new Date(coupon.starts_at) > now) {
    return invalid("Este cupom ainda não está válido.");
  }
  if (coupon.expires_at && new Date(coupon.expires_at) < now) {
    return invalid("Este cupom expirou.");
  }
  if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) {
    return invalid("Este cupom atingiu o limite de usos.");
  }
  if (subtotalCents < coupon.min_order_cents) {
    return invalid("Seu carrinho não atinge o valor mínimo deste cupom.");
  }

  if (coupon.kind === "free_shipping") {
    return { valid: true, discountCents: 0, freeShipping: true };
  }

  const rawDiscount =
    coupon.kind === "percent" ? percentOf(subtotalCents, coupon.value) : coupon.value;

  // O desconto nunca pode ultrapassar o subtotal.
  const discountCents = Math.min(rawDiscount, subtotalCents);

  if (discountCents <= 0) return invalid("Este cupom não gera desconto neste carrinho.");

  return { valid: true, discountCents, freeShipping: false };
}

export function describeCoupon(coupon: Coupon): string {
  switch (coupon.kind) {
    case "percent":
      return `${coupon.value}% de desconto`;
    case "fixed":
      return `R$ ${(coupon.value / 100).toFixed(2).replace(".", ",")} de desconto`;
    case "free_shipping":
      return "frete grátis";
    default:
      return "desconto";
  }
}
