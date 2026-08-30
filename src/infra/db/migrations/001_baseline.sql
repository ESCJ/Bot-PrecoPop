-- Baseline: reflete o schema legado. Idempotente para bancos novos e existentes.

CREATE TABLE IF NOT EXISTS users (
  id          BIGINT PRIMARY KEY,
  name        TEXT NOT NULL,
  cpf         TEXT NOT NULL UNIQUE,
  address     TEXT NOT NULL,
  zip_code    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS items (
  id           SERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  photo_url    TEXT,
  price_cents  INTEGER NOT NULL,
  stock        INTEGER NOT NULL DEFAULT 0,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  sold_out     BOOLEAN NOT NULL DEFAULT FALSE,
  created_by   BIGINT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id                SERIAL PRIMARY KEY,
  user_id           BIGINT NOT NULL,
  item_id           INTEGER NOT NULL,
  quantity          INTEGER NOT NULL,
  unit_price_cents  INTEGER NOT NULL,
  total_cents       INTEGER NOT NULL,
  payment_method    TEXT NOT NULL,
  mp_payment_id     TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  shipped           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at           TIMESTAMPTZ
);
