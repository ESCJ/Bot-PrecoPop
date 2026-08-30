import crypto from "node:crypto";

/**
 * Valida a assinatura HMAC-SHA256 do webhook do Mercado Pago.
 *
 * O provedor assina o template `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
 * e envia o resultado no cabeçalho `x-signature` como `ts=...,v1=...`.
 *
 * Função pura e sem dependências de configuração — a comparação é feita em
 * tempo constante e o tamanho é conferido antes, pois `timingSafeEqual`
 * lança exceção quando os buffers têm tamanhos diferentes.
 */
export function verifyMercadoPagoSignature(input: {
  signatureHeader: string | undefined;
  requestId: string | undefined;
  dataId: string | undefined;
  secret: string;
}): boolean {
  const { signatureHeader, requestId, dataId, secret } = input;

  if (!signatureHeader || !dataId || !secret) return false;

  const parts = signatureHeader.split(",").map((part) => part.trim());
  const ts = parts.find((part) => part.startsWith("ts="))?.slice(3);
  const received = parts.find((part) => part.startsWith("v1="))?.slice(3);

  if (!ts || !received) return false;
  if (!/^[0-9a-fA-F]+$/.test(received)) return false;

  const template = `id:${dataId.toLowerCase()};request-id:${requestId ?? ""};ts:${ts};`;
  const expected = crypto.createHmac("sha256", secret).update(template).digest("hex");

  const receivedBuffer = Buffer.from(received, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (receivedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}
