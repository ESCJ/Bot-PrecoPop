-- Cache de consultas de CEP para reduzir dependência do ViaCEP.

CREATE TABLE IF NOT EXISTS cep_cache (
  zip_code      TEXT PRIMARY KEY,
  street        TEXT,
  neighborhood  TEXT,
  city          TEXT,
  state         TEXT,
  cached_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
