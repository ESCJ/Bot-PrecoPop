import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { withClient } from "./pool";
import { logger } from "../logger";

const MIGRATION_LOCK_ID = 918_273_645;

function migrationsDir(): string {
  const compiled = path.join(__dirname, "migrations");
  if (fs.existsSync(compiled)) return compiled;
  // Em execução via tsx/ts-node o diretório é o mesmo; fallback defensivo.
  return path.join(process.cwd(), "src", "infra", "db", "migrations");
}

interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

function loadMigrations(): MigrationFile[] {
  const dir = migrationsDir();
  if (!fs.existsSync(dir)) {
    throw new Error(`Diretório de migrations não encontrado: ${dir}`);
  }

  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, "en"))
    .map((name) => {
      const sql = fs.readFileSync(path.join(dir, name), "utf8");
      const checksum = crypto.createHash("sha256").update(sql).digest("hex");
      return { name, sql, checksum };
    });
}

/**
 * Aplica migrations pendentes de forma segura para múltiplas réplicas.
 * Usa advisory lock do Postgres para garantir que apenas uma instância
 * execute as migrations por vez.
 */
export async function runMigrations(): Promise<void> {
  const migrations = loadMigrations();

  await withClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        TEXT PRIMARY KEY,
        checksum    TEXT NOT NULL,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);

    try {
      const { rows } = await client.query<{ name: string; checksum: string }>(
        "SELECT name, checksum FROM schema_migrations"
      );
      const applied = new Map(rows.map((row) => [row.name, row.checksum]));

      for (const migration of migrations) {
        const existing = applied.get(migration.name);

        if (existing) {
          if (existing !== migration.checksum) {
            logger.warn(
              { migration: migration.name },
              "Migration já aplicada foi alterada no código. O conteúdo em disco será ignorado."
            );
          }
          continue;
        }

        logger.info({ migration: migration.name }, "Aplicando migration");
        try {
          await client.query("BEGIN");
          await client.query(migration.sql);
          await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [
            migration.name,
            migration.checksum,
          ]);
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          logger.error({ err, migration: migration.name }, "Migration falhou");
          throw err;
        }
      }

      logger.info({ total: migrations.length }, "Migrations em dia");
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
    }
  });
}
