import { db } from "../db/pool";
import { config } from "../../config/env";
import { logger } from "../logger";

/**
 * Store de sessão do Telegraf apoiado em Postgres.
 * Sem isso, todo deploy do Railway apagaria cadastros e carrinhos em andamento.
 */
export function createPostgresSessionStore<T>() {
  return {
    async get(key: string): Promise<T | undefined> {
      try {
        const row = await db.queryOne<{ data: T }>("SELECT data FROM sessions WHERE key = $1", [
          key,
        ]);
        return row?.data;
      } catch (err) {
        logger.error({ err, key }, "Falha ao ler sessão");
        return undefined;
      }
    },

    async set(key: string, value: T): Promise<void> {
      try {
        await db.execute(
          `INSERT INTO sessions (key, data, updated_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
          [key, JSON.stringify(value ?? {})]
        );
      } catch (err) {
        logger.error({ err, key }, "Falha ao gravar sessão");
      }
    },

    async delete(key: string): Promise<void> {
      try {
        await db.execute("DELETE FROM sessions WHERE key = $1", [key]);
      } catch (err) {
        logger.error({ err, key }, "Falha ao remover sessão");
      }
    },
  };
}

/** Remove sessões inativas além do TTL configurado. */
export async function pruneSessions(): Promise<number> {
  try {
    return await db.execute(
      `DELETE FROM sessions WHERE updated_at < NOW() - ($1 || ' days')::INTERVAL`,
      [config.telegram.sessionTtlDays]
    );
  } catch (err) {
    logger.error({ err }, "Falha ao limpar sessões antigas");
    return 0;
  }
}
