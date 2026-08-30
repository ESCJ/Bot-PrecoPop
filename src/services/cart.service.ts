import { CartTotals, User } from "../domain/types";
import { sumCents } from "../domain/money";
import { ValidationError } from "../domain/errors";
import {
  addToCart,
  clearCart,
  getCartCouponId,
  listCartLines,
  removeCartItem,
  setCartCoupon,
  setCartItemQuantity,
} from "../repositories/carts.repo";
import { findCouponById, findCouponByCode } from "../repositories/coupons.repo";
import { findVariantById } from "../repositories/items.repo";
import { evaluateCoupon } from "./coupons.service";
import { quoteShipping } from "./shipping.service";

export const MAX_QUANTITY_PER_LINE = 99;

/** Calcula subtotal, desconto, frete e total do carrinho do usuário. */
export async function getCartTotals(user: User): Promise<CartTotals> {
  const lines = await listCartLines(user.id);
  const subtotal = sumCents(lines.map((line) => line.line_total_cents));

  const couponId = await getCartCouponId(user.id);
  const coupon = couponId ? ((await findCouponById(couponId)) ?? null) : null;
  const evaluation = evaluateCoupon(coupon, subtotal);

  // Cupom que deixou de ser válido é removido silenciosamente do carrinho.
  if (coupon && !evaluation.valid) {
    await setCartCoupon(user.id, null);
  }

  const appliedCoupon = evaluation.valid ? coupon : null;
  const discount = evaluation.valid ? evaluation.discountCents : 0;

  const shipping =
    lines.length > 0
      ? await quoteShipping(user.state, subtotal, evaluation.valid && evaluation.freeShipping)
      : null;

  const shippingCents = shipping?.price_cents ?? 0;
  const total = Math.max(subtotal - discount + shippingCents, 0);

  return {
    lines,
    subtotal_cents: subtotal,
    discount_cents: discount,
    shipping_cents: shippingCents,
    total_cents: total,
    coupon: appliedCoupon,
    shipping,
  };
}

export async function addVariantToCart(
  userId: number,
  variantId: number,
  quantity: number
): Promise<void> {
  const variant = await findVariantById(variantId);
  if (!variant || !variant.active || !variant.item_active) {
    throw new ValidationError("Este produto não está mais disponível.");
  }

  const lines = await listCartLines(userId);
  const current = lines.find((line) => line.variant_id === variantId)?.quantity ?? 0;
  const desired = current + quantity;

  if (desired > MAX_QUANTITY_PER_LINE) {
    throw new ValidationError(
      `O limite por produto é de ${MAX_QUANTITY_PER_LINE} unidades no mesmo pedido.`
    );
  }
  if (desired > variant.available) {
    throw new ValidationError(
      variant.available > 0
        ? `Só temos ${variant.available} unidade(s) disponível(is) deste produto.`
        : "Este produto acabou de esgotar."
    );
  }

  await addToCart(userId, variantId, quantity);
}

export async function changeCartQuantity(
  userId: number,
  cartItemId: number,
  delta: number
): Promise<void> {
  const lines = await listCartLines(userId);
  const line = lines.find((entry) => entry.cart_item_id === cartItemId);
  if (!line) throw new ValidationError("Item não encontrado no carrinho.");

  const next = line.quantity + delta;
  if (next <= 0) {
    await removeCartItem(userId, cartItemId);
    return;
  }
  if (next > Math.min(line.available, MAX_QUANTITY_PER_LINE)) {
    throw new ValidationError(
      `Disponibilidade máxima: ${Math.min(line.available, MAX_QUANTITY_PER_LINE)} unidade(s).`
    );
  }

  await setCartItemQuantity(userId, cartItemId, next);
}

export async function removeFromCart(userId: number, cartItemId: number): Promise<void> {
  await removeCartItem(userId, cartItemId);
}

export async function emptyCart(userId: number): Promise<void> {
  await clearCart(userId);
}

/** Aplica um cupom pelo código, validando contra o subtotal atual. */
export async function applyCouponByCode(user: User, code: string): Promise<string> {
  const coupon = await findCouponByCode(code);
  const lines = await listCartLines(user.id);
  const subtotal = sumCents(lines.map((line) => line.line_total_cents));

  const evaluation = evaluateCoupon(coupon, subtotal);
  if (!evaluation.valid || !coupon) {
    throw new ValidationError(evaluation.reason ?? "Cupom inválido.");
  }

  await setCartCoupon(user.id, coupon.id);
  return coupon.code;
}

export async function removeCoupon(userId: number): Promise<void> {
  await setCartCoupon(userId, null);
}

/** Garante que todas as linhas ainda cabem no estoque disponível. */
export function assertCartIsFulfillable(totals: CartTotals): void {
  if (totals.lines.length === 0) {
    throw new ValidationError("Seu carrinho está vazio.");
  }

  const problem = totals.lines.find((line) => line.quantity > line.available);
  if (problem) {
    throw new ValidationError(
      problem.available > 0
        ? `"${problem.item_title}" tem apenas ${problem.available} unidade(s) disponível(is).`
        : `"${problem.item_title}" esgotou. Remova o item para continuar.`
    );
  }
}
