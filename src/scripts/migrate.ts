import { runMigrations } from "../infra/db/migrator";
import { closePool } from "../infra/db/pool";
import { logger } from "../infra/logger";

runMigrations()
  .then(async () => {
    await closePool();
    logger.info("Migrations aplicadas com sucesso");
    process.exit(0);
  })
  .catch(async (err) => {
    logger.fatal({ err }, "Falha ao aplicar migrations");
    await closePool().catch(() => undefined);
    process.exit(1);
  });
