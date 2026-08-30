import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyMercadoPagoSignature } from "../../src/domain/signature";

const SECRET = "segredo-de-teste-webhook";

function sign(dataId: string, requestId: string, ts: string, secret = SECRET): string {
  const template = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const hash = crypto.createHmac("sha256", secret).update(template).digest("hex");
  return `ts=${ts},v1=${hash}`;
}

describe("Assinatura do webhook do Mercado Pago", () => {
  it("aceita uma assinatura válida", () => {
    const header = sign("123456789", "req-abc", "1700000000");
    expect(
      verifyMercadoPagoSignature({
        signatureHeader: header,
        requestId: "req-abc",
        dataId: "123456789",
        secret: SECRET,
      })
    ).toBe(true);
  });

  it("aceita data.id em maiúsculas, pois o template usa minúsculas", () => {
    const header = sign("abc123", "req-abc", "1700000000");
    expect(
      verifyMercadoPagoSignature({
        signatureHeader: header,
        requestId: "req-abc",
        dataId: "ABC123",
        secret: SECRET,
      })
    ).toBe(true);
  });

  it("rejeita quando o data.id foi adulterado", () => {
    const header = sign("123456789", "req-abc", "1700000000");
    expect(
      verifyMercadoPagoSignature({
        signatureHeader: header,
        requestId: "req-abc",
        dataId: "987654321",
        secret: SECRET,
      })
    ).toBe(false);
  });

  it("rejeita quando o request-id foi adulterado", () => {
    const header = sign("123456789", "req-abc", "1700000000");
    expect(
      verifyMercadoPagoSignature({
        signatureHeader: header,
        requestId: "outro-request",
        dataId: "123456789",
        secret: SECRET,
      })
    ).toBe(false);
  });

  it("rejeita quando o segredo é diferente", () => {
    const header = sign("123456789", "req-abc", "1700000000", "outro-segredo");
    expect(
      verifyMercadoPagoSignature({
        signatureHeader: header,
        requestId: "req-abc",
        dataId: "123456789",
        secret: SECRET,
      })
    ).toBe(false);
  });

  it("rejeita cabeçalhos ausentes ou malformados", () => {
    const base = { requestId: "req", dataId: "123", secret: SECRET };

    expect(verifyMercadoPagoSignature({ ...base, signatureHeader: undefined })).toBe(false);
    expect(verifyMercadoPagoSignature({ ...base, signatureHeader: "lixo" })).toBe(false);
    expect(verifyMercadoPagoSignature({ ...base, signatureHeader: "ts=1" })).toBe(false);
    expect(
      verifyMercadoPagoSignature({
        signatureHeader: "ts=1,v1=abc",
        requestId: "req",
        dataId: undefined,
        secret: SECRET,
      })
    ).toBe(false);
  });

  it("não lança exceção quando o tamanho do hash difere", () => {
    const call = () =>
      verifyMercadoPagoSignature({
        signatureHeader: "ts=1700000000,v1=ab",
        requestId: "req-abc",
        dataId: "123456789",
        secret: SECRET,
      });

    expect(call).not.toThrow();
    expect(call()).toBe(false);
  });

  it("rejeita hash com caracteres não hexadecimais", () => {
    expect(
      verifyMercadoPagoSignature({
        signatureHeader: "ts=1700000000,v1=zzzz",
        requestId: "req-abc",
        dataId: "123456789",
        secret: SECRET,
      })
    ).toBe(false);
  });
});
