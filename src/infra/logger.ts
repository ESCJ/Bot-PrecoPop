import pino from "pino";
import { config } from "../config/env";

const redactPaths = [
  "req.headers.authorization",
  "req.headers['x-signature']",
  "token",
  "accessToken",
  "access_token",
  "botToken",
  "webhookSecret",
  "cpf",
  "*.cpf",
  "*.*.cpf",
];

// O transport do pino-pretty roda em worker thread; fora do desenvolvimento
// isso apenas atrasa a inicialização e mantém o processo vivo em testes.
const usePrettyTransport = config.nodeEnv === "development";

export const logger = pino({
  level: config.nodeEnv === "test" ? "silent" : config.logLevel,
  redact: { paths: redactPaths, censor: "[REDACTED]" },
  base: { service: "preco-pop-bot" },
  formatters: {
    level: (label) => ({ level: label }),
  },
  transport: usePrettyTransport
    ? {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
      }
    : undefined,
});

export type Logger = typeof logger;

/** Mascara um CPF para exibição segura em logs: 123.***.***-45 */
export function maskCpf(cpf: string): string {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return "***";
  return `${digits.slice(0, 3)}.***.***-${digits.slice(9)}`;
}

export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings) as Logger;
}
