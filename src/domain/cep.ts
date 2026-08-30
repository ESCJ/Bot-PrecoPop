import { onlyDigits } from "./cpf";

export const BRAZIL_STATES = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;

export type BrazilState = (typeof BRAZIL_STATES)[number];

export function isValidCep(cep: string): boolean {
  const digits = onlyDigits(cep);
  if (digits.length !== 8) return false;
  // CEPs com todos os dígitos iguais não existem.
  return !/^(\d)\1{7}$/.test(digits);
}

export function normalizeCep(cep: string): string {
  return onlyDigits(cep);
}

export function formatCep(cep: string): string {
  const digits = onlyDigits(cep);
  if (digits.length !== 8) return cep;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export function isValidState(state: string): state is BrazilState {
  return (BRAZIL_STATES as readonly string[]).includes(state.toUpperCase());
}

export interface AddressParts {
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
}

/** Monta o endereço em uma linha legível, ignorando campos vazios. */
export function formatAddress(parts: AddressParts): string {
  const line1 = [parts.street, parts.number].filter(Boolean).join(", ");
  const segments = [
    line1 || null,
    parts.complement || null,
    parts.neighborhood || null,
    [parts.city, parts.state].filter(Boolean).join(" - ") || null,
    parts.zipCode ? `CEP ${formatCep(parts.zipCode)}` : null,
  ].filter((segment): segment is string => Boolean(segment && segment.trim()));

  return segments.join(", ");
}
