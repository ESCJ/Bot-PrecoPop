import { config } from "../../config/env";
import { db } from "../db/pool";
import { logger } from "../logger";
import { normalizeCep } from "../../domain/cep";

export interface CepAddress {
  zipCode: string;
  street: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
}

interface ViaCepResponse {
  cep?: string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean | string;
}

const CACHE_TTL_DAYS = 180;

async function readCache(zipCode: string): Promise<CepAddress | null> {
  try {
    const row = await db.queryOne<{
      zip_code: string;
      street: string | null;
      neighborhood: string | null;
      city: string | null;
      state: string | null;
    }>(
      `SELECT zip_code, street, neighborhood, city, state
         FROM cep_cache
        WHERE zip_code = $1 AND cached_at > NOW() - ($2 || ' days')::INTERVAL`,
      [zipCode, CACHE_TTL_DAYS]
    );
    if (!row) return null;
    return {
      zipCode: row.zip_code,
      street: row.street,
      neighborhood: row.neighborhood,
      city: row.city,
      state: row.state,
    };
  } catch (err) {
    logger.warn({ err }, "Falha ao ler cache de CEP");
    return null;
  }
}

async function writeCache(address: CepAddress): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO cep_cache (zip_code, street, neighborhood, city, state, cached_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (zip_code) DO UPDATE
         SET street = EXCLUDED.street,
             neighborhood = EXCLUDED.neighborhood,
             city = EXCLUDED.city,
             state = EXCLUDED.state,
             cached_at = NOW()`,
      [address.zipCode, address.street, address.neighborhood, address.city, address.state]
    );
  } catch (err) {
    logger.warn({ err }, "Falha ao gravar cache de CEP");
  }
}

/**
 * Consulta o ViaCEP com timeout curto e cache local.
 * Retorna `null` quando o CEP não existe ou o serviço está indisponível —
 * nesses casos o cadastro segue com preenchimento manual.
 */
export async function lookupCep(rawCep: string): Promise<CepAddress | null> {
  const zipCode = normalizeCep(rawCep);
  if (zipCode.length !== 8) return null;

  const cached = await readCache(zipCode);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.viaCep.timeoutMs);

  try {
    const response = await fetch(`https://viacep.com.br/ws/${zipCode}/json/`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      logger.warn({ zipCode, status: response.status }, "ViaCEP respondeu com erro");
      return null;
    }

    const data = (await response.json()) as ViaCepResponse;
    if (data.erro) return null;

    const address: CepAddress = {
      zipCode,
      street: data.logradouro?.trim() || null,
      neighborhood: data.bairro?.trim() || null,
      city: data.localidade?.trim() || null,
      state: data.uf?.trim().toUpperCase() || null,
    };

    if (!address.city || !address.state) return null;

    await writeCache(address);
    return address;
  } catch (err) {
    const aborted = (err as Error)?.name === "AbortError";
    logger.warn({ err, zipCode, aborted }, "Consulta ao ViaCEP falhou");
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
