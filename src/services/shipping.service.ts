import { config } from "../config/env";
import { ShippingQuote } from "../domain/types";
import { findRateByState } from "../repositories/shipping.repo";

/**
 * Calcula o frete a partir da UF do cliente.
 * Aplica frete grátis quando o subtotal atinge o limite configurado
 * ou quando um cupom de frete grátis foi informado.
 */
export async function quoteShipping(
  state: string | null | undefined,
  subtotalCents: number,
  freeShippingCoupon = false
): Promise<ShippingQuote> {
  const rate = state ? await findRateByState(state) : undefined;

  const basePrice = rate?.price_cents ?? config.checkout.defaultShippingCents;
  const daysMin = rate?.days_min ?? 5;
  const daysMax = rate?.days_max ?? 15;

  if (freeShippingCoupon) {
    return { price_cents: 0, days_min: daysMin, days_max: daysMax, free: true, reason: "cupom" };
  }

  const threshold = config.checkout.freeShippingThresholdCents;
  if (threshold > 0 && subtotalCents >= threshold) {
    return { price_cents: 0, days_min: daysMin, days_max: daysMax, free: true, reason: "limite" };
  }

  return { price_cents: basePrice, days_min: daysMin, days_max: daysMax, free: false };
}

export function describeShipping(quote: ShippingQuote | null): string {
  if (!quote) return "a calcular";
  const window = `${quote.days_min}-${quote.days_max} dias úteis`;
  return quote.free ? `Grátis (${window})` : window;
}
