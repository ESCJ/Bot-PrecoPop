import { describe, expect, it } from "vitest";
import {
  bold,
  code,
  esc,
  methodLabel,
  statusLabel,
  truncateCaption,
  truncateMessage,
} from "../../src/bot/ui/format";

describe("Escape de HTML", () => {
  it("neutraliza caracteres que quebrariam a mensagem", () => {
    expect(esc('<b>oi</b> & "aspas"')).toBe('&lt;b&gt;oi&lt;/b&gt; &amp; "aspas"');
  });

  it("escapa títulos de produto com markup acidental", () => {
    expect(esc("Camiseta <Premium> & Cia")).toBe("Camiseta &lt;Premium&gt; &amp; Cia");
    expect(esc("Promo *imperdível* _hoje_")).toBe("Promo *imperdível* _hoje_");
  });

  it("trata valores nulos sem quebrar", () => {
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
    expect(esc(0)).toBe("0");
  });

  it("aplica escape dentro das tags de formatação", () => {
    expect(bold("<script>")).toBe("<b>&lt;script&gt;</b>");
    expect(code("a<b")).toBe("<code>a&lt;b</code>");
  });
});

describe("Truncamento", () => {
  it("respeita o limite de legenda do Telegram", () => {
    const long = "a".repeat(2_000);
    expect(truncateCaption(long).length).toBeLessThanOrEqual(1_000);
    expect(truncateCaption("curto")).toBe("curto");
  });

  it("respeita o limite de mensagem do Telegram", () => {
    const long = "a".repeat(9_000);
    expect(truncateMessage(long).length).toBeLessThanOrEqual(4_000);
  });
});

describe("Rótulos", () => {
  it("traduz status de pedido", () => {
    expect(statusLabel("paid")).toBe("Pago");
    expect(statusLabel("pending")).toBe("Aguardando pagamento");
    expect(statusLabel("desconhecido")).toBe("desconhecido");
  });

  it("traduz meios de pagamento", () => {
    expect(methodLabel("pix")).toBe("Pix");
    expect(methodLabel("credit_card")).toBe("Cartão de crédito");
  });
});
