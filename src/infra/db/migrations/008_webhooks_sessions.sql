-- Idempotência de webhooks e sessões persistentes do Telegram.

CREATE TABLE IF NOT EXISTS processed_webhooks (
  id            SERIAL PRIMARY KEY,
  provider      TEXT NOT NULL,
  event_id      TEXT NOT NULL,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT processed_webhooks_unique UNIQUE (provider, event_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  key         TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);
