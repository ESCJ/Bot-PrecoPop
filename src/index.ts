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

  if (config.telegram.useWebhook) {
    // `webhookUrl` já inclui o caminho — registrar só a URL base faria o
    // Telegram entregar os updates em uma rota que ninguém escuta.
    await bot.telegram.setWebhook(config.telegram.webhookUrl!, {
      secret_token: config.telegram.webhookSecret,
      drop_pending_updates: false,
      allowed_updates: ["message", "callback_query"],
    });
    logger.info({ webhookUrl: config.telegram.webhookUrl }, "Webhook do Telegram configurado");
  } else {
    // Desenvolvimento: sem URL pública, o bot busca os updates por long polling.
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
    void bot.launch({ allowedUpdates: ["message", "callback_query"] });
    logger.info("Bot em long polling (WEBHOOK_URL não definido)");
  }

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
