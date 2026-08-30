/**
 * Escapa texto para uso com `parse_mode: "HTML"`.
 * Todo conteúdo vindo do usuário ou do banco DEVE passar por aqui —
 * é o que impede um título com "<" ou "&" de quebrar a mensagem inteira.
 */
export function esc(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function bold(value: unknown): string {
  return `<b>${esc(value)}</b>`;
}

export function italic(value: unknown): string {
  return `<i>${esc(value)}</i>`;
}

export function code(value: unknown): string {
  return `<code>${esc(value)}</code>`;
}

export function link(label: string, url: string): string {
  return `<a href="${esc(url)}">${esc(label)}</a>`;
}

/** Trunca respeitando o limite de legenda do Telegram (1024 caracteres). */
export function truncateCaption(text: string, max = 1000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/** Trunca respeitando o limite de mensagem do Telegram (4096 caracteres). */
export function truncateMessage(text: string, max = 4000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

export function formatDateOnly(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Aguardando pagamento",
  paid: "Pago",
  cancelled: "Cancelado",
  expired: "Expirado",
  refunded: "Reembolsado",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

const METHOD_LABELS: Record<string, string> = {
  pix: "Pix",
  credit_card: "Cartão de crédito",
  debit_card: "Cartão de débito",
  boleto: "Boleto",
};

export function methodLabel(method: string): string {
  return METHOD_LABELS[method] ?? method;
}
