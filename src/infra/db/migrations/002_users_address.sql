-- Endereço estruturado com preenchimento automático por CEP.
-- O texto legado de `address` é preservado integralmente em `street`.

ALTER TABLE users ADD COLUMN IF NOT EXISTS street       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS number       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS complement   TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS neighborhood TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS city         TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS state        TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone        TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_bot  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill conservador: nada é descartado.
UPDATE users
SET street = COALESCE(NULLIF(TRIM(street), ''), address)
WHERE street IS NULL OR TRIM(street) = '';

-- `address` deixa de ser obrigatório; passa a ser um cache legível do endereço.
ALTER TABLE users ALTER COLUMN address DROP NOT NULL;
