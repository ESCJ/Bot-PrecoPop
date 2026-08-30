import { Queryable } from "../infra/db/pool";

/**
 * Registra um evento de webhook. Retorna `false` se o evento já foi
 * processado antes, garantindo idempotência mesmo com reenvios do provedor.
 */
export async function claimWebhookEvent(
  tx: Queryable,
  provider: string,
  eventId: string
): Promise<boolean> {
  const affected = await tx.execute(
    `INSERT INTO processed_webhooks (provider, event_id)
     VALUES ($1, $2)
     ON CONFLICT (provider, event_id) DO NOTHING`,
    [provider, eventId]
  );
  return affected > 0;
}
