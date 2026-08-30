import { describe, expect, it } from "vitest";
import { buildTelegramWebhookUrl } from "../../src/domain/urls";

describe("URL do webhook do Telegram", () => {
  it("anexa o caminho quando recebe apenas a URL base", () => {
    expect(buildTelegramWebhookUrl("https://app.up.railway.app")).toBe(
      "https://app.up.railway.app/webhook/telegram"
    );
  });

  it("ignora barras extras no final da base", () => {
    expect(buildTelegramWebhookUrl("https://app.up.railway.app///")).toBe(
      "https://app.up.railway.app/webhook/telegram"
    );
  });

  it("não duplica o caminho quando ele já foi informado", () => {
    expect(buildTelegramWebhookUrl("https://app.up.railway.app/webhook/telegram")).toBe(
      "https://app.up.railway.app/webhook/telegram"
    );
  });

  it("remove a barra final mesmo quando o caminho já está presente", () => {
    expect(buildTelegramWebhookUrl("https://app.up.railway.app/webhook/telegram/")).toBe(
      "https://app.up.railway.app/webhook/telegram"
    );
  });

  it("tolera espaços em volta do valor da variável", () => {
    expect(buildTelegramWebhookUrl("  https://app.up.railway.app  ")).toBe(
      "https://app.up.railway.app/webhook/telegram"
    );
  });

  it("aceita um caminho customizado", () => {
    expect(buildTelegramWebhookUrl("https://app.example.com", "/tg")).toBe(
      "https://app.example.com/tg"
    );
  });
});
