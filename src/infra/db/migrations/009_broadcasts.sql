-- Campanhas de broadcast com acompanhamento por destinatário.

CREATE TABLE IF NOT EXISTS broadcasts (
  id             SERIAL PRIMARY KEY,
  message        TEXT NOT NULL,
  photo_file_id  TEXT,
  created_by     BIGINT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued', 'sending', 'done', 'failed')),
  total_targets  INTEGER NOT NULL DEFAULT 0,
  sent_count     INTEGER NOT NULL DEFAULT 0,
  failed_count   INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS broadcast_targets (
  id            SERIAL PRIMARY KEY,
  broadcast_id  INTEGER NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  user_id       BIGINT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'sent', 'failed')),
  error         TEXT,
  sent_at       TIMESTAMPTZ,
  CONSTRAINT broadcast_targets_unique UNIQUE (broadcast_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_broadcast_targets_pending
  ON broadcast_targets(broadcast_id) WHERE status = 'pending';
