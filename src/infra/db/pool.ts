import { Pool, PoolClient, QueryResultRow } from "pg";
import { config } from "../../config/env";
import { logger } from "../logger";

export const pool = new Pool({
  connectionString: config.database.url,
  max: config.database.poolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
  ssl: config.database.ssl ? { rejectUnauthorized: false } : undefined,
});

pool.on("error", (err) => {
  logger.error({ err }, "Erro inesperado em cliente ocioso do pool Postgres");
});

export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[]
  ): Promise<T | undefined>;
  execute(sql: string, params?: unknown[]): Promise<number>;
}

function wrap(runner: Pool | PoolClient): Queryable {
  return {
    async query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
      const result = await runner.query<T>(sql, params as never[]);
      return result.rows;
    },
    async queryOne<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
      const result = await runner.query<T>(sql, params as never[]);
      return result.rows[0] as T | undefined;
    },
    async execute(sql: string, params: unknown[] = []) {
      const result = await runner.query(sql, params as never[]);
      return result.rowCount ?? 0;
    },
  };
}

/** Executa uma query fora de transação, usando o pool. */
export const db: Queryable = wrap(pool);

/**
 * Executa uma função dentro de uma transação. Faz COMMIT em sucesso e
 * ROLLBACK em qualquer erro, sempre devolvendo o cliente ao pool.
 */
export async function withTransaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(wrap(client));
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      logger.error({ err: rollbackErr }, "Falha ao executar ROLLBACK");
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Executa uma função com um cliente dedicado (sem transação implícita). */
export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function pingDatabase(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch (err) {
    logger.error({ err }, "Health check do banco falhou");
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
