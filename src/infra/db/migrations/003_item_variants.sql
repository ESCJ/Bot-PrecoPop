-- Variações de produto (tamanho, cor, etc). Todo item passa a ter ao menos
-- a variação "Padrão", que herda o estoque legado.

ALTER TABLE items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'items' AND column_name = 'photo_url'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'items' AND column_name = 'photo_file_id'
  ) THEN
    ALTER TABLE items RENAME COLUMN photo_url TO photo_file_id;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS item_variants (
  id           SERIAL PRIMARY KEY,
  item_id      INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  name         TEXT NOT NULL DEFAULT 'Padrão',
  sku          TEXT,
  price_cents  INTEGER,
  stock        INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  reserved     INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT item_variants_reserved_within_stock CHECK (reserved <= stock),
  CONSTRAINT item_variants_unique_name UNIQUE (item_id, name)
);

-- Migra o estoque existente para a variação padrão.
INSERT INTO item_variants (item_id, name, price_cents, stock, active)
SELECT i.id, 'Padrão', NULL, GREATEST(i.stock, 0), NOT i.sold_out
FROM items i
WHERE NOT EXISTS (SELECT 1 FROM item_variants v WHERE v.item_id = i.id);

CREATE INDEX IF NOT EXISTS idx_item_variants_item ON item_variants(item_id);
CREATE INDEX IF NOT EXISTS idx_items_active ON items(active) WHERE active;
