import express, { Application, Request, Response } from "express";
import helmet from "helmet";
import { Telegraf } from "telegraf";
import { config } from "../config/env";
import { MyContext } from "../domain/types";
import { logger } from "../infra/logger";
import { pingDatabase } from "../infra/db/pool";
import { mercadoPagoRouter } from "./routes/mercadopago.webhook";

const RETURN_PAGES: Record<string, { title: string; message: string }> = {
  sucesso: {
    title: "Pagamento aprovado",
    message: "Tudo certo! Volte ao Telegram para acompanhar seu pedido.",
  },
  pendente: {
    title: "Pagamento em análise",
    message: "Assim que for confirmado, avisaremos você no Telegram.",
  },
  falha: {
    title: "Pagamento não concluído",
    message: "Nenhum valor foi cobrado. Você pode tentar novamente pelo Telegram.",
  },
};

function returnPage(kind: keyof typeof RETURN_PAGES): string {
  const page = RETURN_PAGES[kind]!;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title}</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0;
         min-height: 100vh; display: grid; place-items: center; background: #0f172a; color: #e2e8f0; }
  main { text-align: center; padding: 2rem; max-width: 28rem; }
  h1 { font-size: 1.5rem; margin-bottom: 0.75rem; }
  p { color: #94a3b8; line-height: 1.6; }
</style>
</head>
<body><main><h1>${page.title}</h1><p>${page.message}</p></main></body>
</html>`;
}

export function createServer(bot: Telegraf<MyContext>): Application {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false }));

  // O corpo bruto precisa ser montado ANTES do parser JSON global,
  // caso contrário a validação de assinatura recebe um objeto já parseado.
  app.use(
    config.mercadoPago.webhookPath,
    express.raw({ type: "application/json", limit: "1mb" }),
    mercadoPagoRouter(bot)
  );

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", async (_req: Request, res: Response) => {
    const databaseUp = await pingDatabase();
    res.status(databaseUp ? 200 : 503).json({
      status: databaseUp ? "ok" : "degraded",
      database: databaseUp ? "up" : "down",
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/", (_req: Request, res: Response) => {
    res.json({ service: config.storeName, status: "online" });
  });

  for (const kind of Object.keys(RETURN_PAGES)) {
    app.get(`/pagamento/${kind}`, (_req: Request, res: Response) => {
      res.type("html").send(returnPage(kind as keyof typeof RETURN_PAGES));
    });
  }

  // Webhook do Telegram protegido por secret token.
  app.use(
    bot.webhookCallback(config.telegram.webhookPath, {
      secretToken: config.telegram.webhookSecret,
    })
  );

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "not_found" });
  });

  app.use((err: Error, _req: Request, res: Response, _next: express.NextFunction): void => {
    logger.error({ err }, "Erro não tratado no servidor HTTP");
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
