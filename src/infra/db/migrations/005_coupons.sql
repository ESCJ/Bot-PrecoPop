-- Cupons de desconto.

CREATE TABLE IF NOT EXISTS coupons (
  id               SERIAL PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,
  kind             TEXT NOT NULL CHECK (kind IN ('percent', 'fixed', 'free_shipping')),
  value            INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0),
  min_order_cents  INTEGER NOT NULL DEFAULT 0 CHECK (min_order_cents >= 0),
  max_uses         INTEGER,
  used_count       INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  starts_at        TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_by       BIGINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT coupons_percent_range CHECK (kind <> 'percent' OR (value > 0 AND value <= 100))
);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(UPPER(code));

ALTER TABLE carts
  ADD CONSTRAINT carts_coupon_fk FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE SET NULL;
