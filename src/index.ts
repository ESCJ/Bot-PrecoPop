import "dotenv/config";
import express from "express";
import bodyParser from "body-parser";
import { createBot } from "./bot";
import { config } from "./config";
import { createWebhookRouter } from "./handlers/webhooks";
import { getDb } from "./db";

async function main() {
  await getDb();
  console.log("Banco de dados inicializado.");

  const app = express();
  app.use(express.json());

  const bot = createBot();

  app.use("/webhooks", express.raw({ type: "application/json" }), createWebhookRouter(bot));

  // Endpoint de health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  if (config.telegram.webhookUrl) {
    const webhookPath = "/webhook/telegram";
    app.use(bot.webhookCallback(webhookPath));
    await bot.telegram.setWebhook(`${config.telegram.webhookUrl}${webhookPath}`, {
      secret_token: config.telegram.webhookSecret,
    });
    console.log(`Webhook do Telegram configurado em ${config.telegram.webhookUrl}${webhookPath}`);
  } else {
    console.log("WEBHOOK_URL não configurado. Usando polling (modo desenvolvimento).");
    bot.launch();
  }

  app.listen(config.server.port, () => {
    console.log(`Servidor rodando na porta ${config.server.port}`);
  });
}

main().catch((err) => {
  console.error("Erro ao iniciar aplicação:", err);
  process.exit(1);
});
