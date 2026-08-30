const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Formata centavos como moeda brasileira. Ex.: 1990 -> "R$ 19,90". */
export function formatPrice(cents: number): string {
  return BRL.format(Math.round(cents) / 100);
}

/**
 * Converte texto digitado pelo usuário em centavos.
 * Aceita "19,90", "19.90", "R$ 19,90", "1.234,56" e "1990".
 * Retorna null quando o valor não é um número válido e positivo.
 */
export function parsePriceToCents(input: string): number | null {
  const raw = input.trim().replace(/[R$\s]/gi, "");
  if (!raw) return null;

  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");

  let normalized: string;
  if (hasComma && hasDot) {
    // Formato brasileiro: ponto é separador de milhar, vírgula é decimal.
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = raw.replace(",", ".");
  } else {
    normalized = raw;
  }

  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;

  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;

  const cents = Math.round(value * 100);
  if (cents <= 0 || cents > 100_000_000) return null;
  return cents;
}

/** Soma valores em centavos evitando qualquer aritmética de ponto flutuante. */
export function sumCents(values: number[]): number {
  return values.reduce((total, value) => total + Math.round(value), 0);
}

/** Aplica um desconto percentual arredondando para o centavo mais próximo. */
export function percentOf(cents: number, percent: number): number {
  return Math.round((cents * percent) / 100);
}

export function parseQuantity(input: string, max = 999): number | null {
  const trimmed = input.trim();
  if (!/^\d{1,4}$/.test(trimmed)) return null;
  const value = Number.parseInt(trimmed, 10);
  if (value <= 0 || value > max) return null;
  return value;
}
