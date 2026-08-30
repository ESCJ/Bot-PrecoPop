import { defineRailway, github, postgres, preserve, project, service, volume } from "railway/iac";

/**
 * Infrastructure as Code do projeto (substitui o railway.json, descontinuado).
 *
 * Os valores das variáveis ficam no Railway: `preserve()` mantém o que já está
 * definido lá, para que nenhum segredo precise ser versionado neste arquivo.
 */
export default defineRailway(() => {
  const Postgres = postgres("Postgres", { region: "us-west2" });

  const postgresVolume = volume("postgres-volume", {
    alerts: { usage: { "80": {}, "95": {}, "100": {} } },
    allowOnlineResize: true,
    region: "us-west2",
    sizeMB: 5000,
  });

  const PrecoPopGrupoVip = service("PrecoPopGrupoVip", {
    source: github("ESCJ/Bot-PrecoPop", { checkSuites: false }),
    replicas: { "us-west2": 1 },
    networking: { privateNetworkEndpoint: "web" },

    build: {
      builder: "NIXPACKS",
      buildCommand: "npm run build",
      // Evita rebuild quando só a documentação ou os testes mudam.
      watchPatterns: ["src/**", "scripts/**", "package.json", "package-lock.json", "tsconfig.json"],
    },

    deploy: {
      startCommand: "npm start",
      // O /health confere a conexão com o Postgres, não só o processo.
      healthcheckPath: "/health",
      healthcheckTimeout: 120,
      // restartPolicy (ON_FAILURE, 10 tentativas) e sleepApplication (desligado)
      // são os padrões do Railway, guardados como null. Declará-los aqui geraria
      // drift permanente no `railway config plan`, então ficam de fora.
    },

    env: {
      NODE_ENV: preserve(),
      LOG_LEVEL: preserve(),
      STORE_NAME: preserve(),

      TELEGRAM_BOT_TOKEN: preserve(),
      TELEGRAM_WEBHOOK_SECRET: preserve(),
      WEBHOOK_URL: preserve(),
      PUBLIC_URL: preserve(),

      ADMIN_CHAT_ID: preserve(),
      ADMIN_CHAT_IDS: preserve(),
      SHIPPING_GROUP_CHAT_ID: preserve(),

      MERCADO_PAGO_ACCESS_TOKEN: preserve(),
      MERCADO_PAGO_WEBHOOK_SECRET: preserve(),

      DATABASE_URL: preserve(),
      DATABASE_SSL: preserve(),
      DATABASE_POOL_MAX: preserve(),

      PIX_TTL_MINUTES: preserve(),
      FREE_SHIPPING_THRESHOLD_CENTS: preserve(),
      DEFAULT_SHIPPING_CENTS: preserve(),
      VIACEP_TIMEOUT_MS: preserve(),
      SESSION_TTL_DAYS: preserve(),
    },
  });

  return project("BotPreçoPop", {
    resources: [Postgres, PrecoPopGrupoVip, postgresVolume],
  });
});
