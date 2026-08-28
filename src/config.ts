import dotenv from "dotenv";

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function parseIntEnv(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer environment variable: ${key}`);
  }
  return parsed;
}

function parseChatIds(value: string): number[] {
  return value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => {
      const parsed = parseInt(id, 10);
      if (Number.isNaN(parsed)) {
        throw new Error(`Invalid chat id: ${id}`);
      }
      return parsed;
    });
}

export const config = {
  telegram: {
    botToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    webhookSecret: requireEnv("TELEGRAM_WEBHOOK_SECRET"),
    webhookUrl: process.env.WEBHOOK_URL,
  },
  server: {
    port: parseIntEnv("PORT", 3000),
    publicUrl: requireEnv("PUBLIC_URL"),
  },
  admin: {
    chatId: parseInt(requireEnv("ADMIN_CHAT_ID"), 10),
    shippingGroupChatId: parseInt(requireEnv("SHIPPING_GROUP_CHAT_ID"), 10),
  },
  mercadoPago: {
    accessToken: requireEnv("MERCADO_PAGO_ACCESS_TOKEN"),
    webhookSecret: requireEnv("MERCADO_PAGO_WEBHOOK_SECRET"),
  },
  database: {
    url: process.env.DATABASE_URL || "./data/bot.db",
  },
};
