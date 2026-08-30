import "dotenv/config";
import { z } from "zod";
import { buildTelegramWebhookUrl, TELEGRAM_WEBHOOK_PATH } from "../domain/urls";

const csvNumbers = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
  )
  .pipe(z.array(z.coerce.number().int()).min(1));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // "silent" desliga o log por completo — útil em CI e em suítes de teste.
  LOG_LEVEL: z.enum(["silent", "fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  TELEGRAM_BOT_TOKEN: z.string().min(10, "Token do Telegram inválido"),
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,256}$/, "Use apenas letras, números, _ e - (8 a 256 caracteres)"),

  ADMIN_CHAT_IDS: csvNumbers,
  SHIPPING_GROUP_CHAT_ID: z.coerce.number().int(),

  MERCADO_PAGO_ACCESS_TOKEN: z.string().min(10),
  MERCADO_PAGO_WEBHOOK_SECRET: z.string().min(8),

  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_URL: z.string().url(),
  WEBHOOK_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),

  DATABASE_URL: z
    .string()
    .refine(
      (value) => value.startsWith("postgres://") || value.startsWith("postgresql://"),
      "DATABASE_URL deve ser uma conexão PostgreSQL"
    ),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_SSL: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),

  PIX_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  FREE_SHIPPING_THRESHOLD_CENTS: z.coerce.number().int().nonnegative().default(0),
  DEFAULT_SHIPPING_CENTS: z.coerce.number().int().nonnegative().default(2500),
  VIACEP_TIMEOUT_MS: z.coerce.number().int().positive().default(4000),

  STORE_NAME: z.string().default("Grupo Vip - Loja Preço Pop"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(raiz)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Configuração inválida. Corrija as variáveis de ambiente abaixo:\n${details}\n\n` +
        `Consulte o arquivo .env.example para a lista completa.`
    );
  }

  return parsed.data;
}

export const env = loadEnv();

export const config = {
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  logLevel: env.LOG_LEVEL,
  storeName: env.STORE_NAME,
  telegram: {
    botToken: env.TELEGRAM_BOT_TOKEN,
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
    webhookPath: TELEGRAM_WEBHOOK_PATH,
    /** Sem `WEBHOOK_URL` o bot roda em long polling (modo desenvolvimento). */
    useWebhook: Boolean(env.WEBHOOK_URL),
    webhookUrl: env.WEBHOOK_URL ? buildTelegramWebhookUrl(env.WEBHOOK_URL) : null,
    sessionTtlDays: env.SESSION_TTL_DAYS,
  },
  server: {
    port: env.PORT,
    publicUrl: env.PUBLIC_URL.replace(/\/+$/, ""),
  },
  admin: {
    chatIds: env.ADMIN_CHAT_IDS,
    primaryChatId: env.ADMIN_CHAT_IDS[0]!,
    shippingGroupChatId: env.SHIPPING_GROUP_CHAT_ID,
  },
  mercadoPago: {
    accessToken: env.MERCADO_PAGO_ACCESS_TOKEN,
    webhookSecret: env.MERCADO_PAGO_WEBHOOK_SECRET,
    webhookPath: "/webhooks/mercadopago",
  },
  database: {
    url: env.DATABASE_URL,
    poolMax: env.DATABASE_POOL_MAX,
    ssl: env.DATABASE_SSL,
  },
  checkout: {
    pixTtlMinutes: env.PIX_TTL_MINUTES,
    freeShippingThresholdCents: env.FREE_SHIPPING_THRESHOLD_CENTS,
    defaultShippingCents: env.DEFAULT_SHIPPING_CENTS,
  },
  viaCep: {
    timeoutMs: env.VIACEP_TIMEOUT_MS,
  },
} as const;

export function notificationUrl(): string {
  return `${config.server.publicUrl}${config.mercadoPago.webhookPath}`;
}
