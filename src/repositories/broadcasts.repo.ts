import { db } from "../infra/db/pool";
import { Broadcast } from "../domain/types";

const COLUMNS = `id, message, photo_file_id, created_by, status, total_targets,
                 sent_count, failed_count, created_at, finished_at`;

export async function createBroadcast(input: {
  message: string;
  photoFileId: string | null;
  createdBy: number;
  targetIds: number[];
}): Promise<Broadcast> {
  const broadcast = await db.queryOne<Broadcast>(
    `INSERT INTO broadcasts (message, photo_file_id, created_by, total_targets)
     VALUES ($1, $2, $3, $4)
     RETURNING ${COLUMNS}`,
    [input.message, input.photoFileId, input.createdBy, input.targetIds.length]
  );

  if (input.targetIds.length > 0) {
    await db.execute(
      `INSERT INTO broadcast_targets (broadcast_id, user_id)
       SELECT $1, UNNEST($2::bigint[])
       ON CONFLICT DO NOTHING`,
      [broadcast!.id, input.targetIds]
    );
  }

  return broadcast!;
}

export async function findBroadcast(id: number): Promise<Broadcast | undefined> {
  return db.queryOne<Broadcast>(`SELECT ${COLUMNS} FROM broadcasts WHERE id = $1`, [id]);
}

export async function setBroadcastStatus(
  id: number,
  status: Broadcast["status"],
  finished = false
): Promise<void> {
  await db.execute(
    `UPDATE broadcasts SET status = $2, finished_at = CASE WHEN $3 THEN NOW() ELSE finished_at END
      WHERE id = $1`,
    [id, status, finished]
  );
}

export async function nextPendingTargets(
  broadcastId: number,
  limit: number
): Promise<{ id: number; user_id: number }[]> {
  return db.query<{ id: number; user_id: number }>(
    `SELECT id, user_id FROM broadcast_targets
      WHERE broadcast_id = $1 AND status = 'pending'
      ORDER BY id
      LIMIT $2`,
    [broadcastId, limit]
  );
}

export async function markTargetSent(targetId: number): Promise<void> {
  await db.execute("UPDATE broadcast_targets SET status = 'sent', sent_at = NOW() WHERE id = $1", [
    targetId,
  ]);
}

export async function markTargetFailed(targetId: number, error: string): Promise<void> {
  await db.execute(
    "UPDATE broadcast_targets SET status = 'failed', error = $2, sent_at = NOW() WHERE id = $1",
    [targetId, error.slice(0, 500)]
  );
}

export async function refreshBroadcastCounters(id: number): Promise<Broadcast | undefined> {
  return db.queryOne<Broadcast>(
    `UPDATE broadcasts b
        SET sent_count   = (SELECT COUNT(*) FROM broadcast_targets t
                             WHERE t.broadcast_id = b.id AND t.status = 'sent'),
            failed_count = (SELECT COUNT(*) FROM broadcast_targets t
                             WHERE t.broadcast_id = b.id AND t.status = 'failed')
      WHERE b.id = $1
      RETURNING ${COLUMNS}`,
    [id]
  );
}

export async function listRecentBroadcasts(limit = 5): Promise<Broadcast[]> {
  return db.query<Broadcast>(
    `SELECT ${COLUMNS} FROM broadcasts ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
}
