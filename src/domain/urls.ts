export const TELEGRAM_WEBHOOK_PATH = "/webhook/telegram";

/**
 * Monta a URL completa do webhook do Telegram.
 * `WEBHOOK_URL` é documentada como a URL *base*, então o caminho é anexado —
 * registrar apenas a base faria o Telegram entregar os updates em uma rota
 * que ninguém escuta. Se o caminho já veio informado, não duplicamos.
 */
export function buildTelegramWebhookUrl(base: string, path = TELEGRAM_WEBHOOK_PATH): string {
  const trimmed = base.trim().replace(/\/+$/, "");
  return trimmed.endsWith(path) ? trimmed : `${trimmed}${path}`;
}
