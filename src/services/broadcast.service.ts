import { Telegraf } from "telegraf";
import { MyContext } from "../domain/types";
import { logger } from "../infra/logger";
import { isUnreachableUserError, throttler } from "../infra/telegram/throttler";
import {
  createBroadcast,
  markTargetFailed,
  markTargetSent,
  nextPendingTargets,
  refreshBroadcastCounters,
  setBroadcastStatus,
} from "../repositories/broadcasts.repo";
import { listReachableUserIds, markUserBlocked } from "../repositories/users.repo";

const BATCH_SIZE = 50;

export interface BroadcastResult {
  broadcastId: number;
  total: number;
  sent: number;
  failed: number;
}

/**
 * Dispara um comunicado para toda a base alcançável.
 * O envio passa pela fila com throttle e cada destinatário é registrado,
 * de modo que uma falha isolada não interrompe a campanha.
 */
export async function runBroadcast(
  telegram: Telegraf<MyContext>["telegram"],
  input: { message: string; photoFileId: string | null; createdBy: number },
  onProgress?: (sent: number, total: number) => void
): Promise<BroadcastResult> {
  const targetIds = await listReachableUserIds();

  const broadcast = await createBroadcast({
    message: input.message,
    photoFileId: input.photoFileId,
    createdBy: input.createdBy,
    targetIds,
  });

  if (targetIds.length === 0) {
    await setBroadcastStatus(broadcast.id, "done", true);
    return { broadcastId: broadcast.id, total: 0, sent: 0, failed: 0 };
  }

  await setBroadcastStatus(broadcast.id, "sending");

  let processed = 0;

  for (;;) {
    const batch = await nextPendingTargets(broadcast.id, BATCH_SIZE);
    if (batch.length === 0) break;

    await Promise.all(
      batch.map(async (target) => {
        try {
          await throttler.schedule(target.user_id, async () => {
            if (input.photoFileId) {
              await telegram.sendPhoto(target.user_id, input.photoFileId, {
                caption: input.message,
                parse_mode: "HTML",
              });
            } else {
              await telegram.sendMessage(target.user_id, input.message, {
                parse_mode: "HTML",
                link_preview_options: { is_disabled: true },
              });
            }
          });
          await markTargetSent(target.id);
        } catch (err) {
          const reason = (err as Error)?.message ?? "erro desconhecido";
          await markTargetFailed(target.id, reason);

          // Quem bloqueou o bot sai das próximas campanhas automaticamente.
          if (isUnreachableUserError(err)) {
            await markUserBlocked(target.user_id, true).catch(() => undefined);
          } else {
            logger.warn({ err, userId: target.user_id }, "Falha ao enviar comunicado");
          }
        }
      })
    );

    processed += batch.length;
    onProgress?.(processed, targetIds.length);
  }

  const updated = await refreshBroadcastCounters(broadcast.id);
  await setBroadcastStatus(broadcast.id, "done", true);

  logger.info(
    { broadcastId: broadcast.id, sent: updated?.sent_count, failed: updated?.failed_count },
    "Comunicado finalizado"
  );

  return {
    broadcastId: broadcast.id,
    total: targetIds.length,
    sent: updated?.sent_count ?? 0,
    failed: updated?.failed_count ?? 0,
  };
}
