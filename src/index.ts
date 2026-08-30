import http from "node:http";
import { config } from "./config/env";
import { logger } from "./infra/logger";
import { closePool } from "./infra/db/pool";
import { runMigrations } from "./infra/db/migrator";
import { pruneSessions } from "./infra/telegram/session-store";
import { createBot, registerBotCommands } from "./bot";
import { createServer } from "./http/server";
import { releaseExpiredOrders } from "./services/checkout.service";

const RESERVATION_SWEEP_MS = 60_000;
const SESSION_PRUNE_MS = 6 * 60 * 60 * 1000;

async function main(): Promise<void> {
  logger.info({ env: config.nodeEnv }, "Iniciando o bot");

  await runMigrations();

  const bot = createBot();
  const app = createServer(bot);
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(config.server.port, () => {
      logger.info({ port: config.server.port }, "Servidor HTTP ouvindo");
      resolve();
    });
  });

  const webhookUrl =
    config.telegram.webhookUrl ?? `${config.server.publicUrl}${config.telegram.webhookPath}`;

  await bot.telegram.setWebhook(webhookUrl, {
    secret_token: config.telegram.webhookSecret,
    drop_pending_updates: false,
    allowed_updates: ["message", "callback_query"],
  });
  logger.info({ webhookUrl }, "Webhook do Telegram configurado");

  await registerBotCommands(bot);

  // Devolve ao estoque as reservas de pedidos não pagos.
  const reservationSweep = setInterval(() => {
    void releaseExpiredOrders().catch((err) =>
      logger.error({ err }, "Falha na varredura de reservas expiradas")
    );
  }, RESERVATION_SWEEP_MS);

  const sessionPrune = setInterval(() => {
    void pruneSessions().catch(() => undefined);
  }, SESSION_PRUNE_MS);

  reservationSweep.unref();
  sessionPrune.unref();

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, "Encerrando graciosamente");
    clearInterval(reservationSweep);
    clearInterval(sessionPrune);

    const forceExit = setTimeout(() => {
      logger.warn("Tempo de encerramento excedido; forçando saída");
      process.exit(1);
    }, 15_000);
    forceExit.unref();

    try {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      bot.stop(signal);
      await closePool();
      logger.info("Encerramento concluído");
      clearTimeout(forceExit);
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Erro durante o encerramento");
      process.exit(1);
    }
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "Promise rejeitada sem tratamento");
  });

  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Exceção não capturada");
    void shutdown("uncaughtException");
  });

  logger.info("Bot em operação");
}

main().catch((err) => {
  logger.fatal({ err }, "Falha fatal na inicialização");
  process.exit(1);
});
