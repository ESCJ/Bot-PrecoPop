-- Pedidos multi-item com totais detalhados, reserva de estoque e rastreio.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal_cents    INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_cents    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_cents    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_id         INTEGER REFERENCES coupons(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code       TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_snapshot JSONB;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_code     TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at        TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS expires_at        TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at      TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_committed   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_released    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS checkout_url      TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS order_items (
  id                SERIAL PRIMARY KEY,
  order_id          INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id        INTEGER REFERENCES item_variants(id) ON DELETE SET NULL,
  item_id           INTEGER,
  item_title        TEXT NOT NULL,
  variant_name      TEXT NOT NULL DEFAULT 'Padrão',
  unit_price_cents  INTEGER NOT NULL,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  total_cents       INTEGER NOT NULL
);

-- Converte cada pedido legado (item único) em uma linha de order_items.
INSERT INTO order_items (
  order_id, variant_id, item_id, item_title, variant_name,
  unit_price_cents, quantity, total_cents
)
SELECT
  o.id,
  (SELECT v.id FROM item_variants v WHERE v.item_id = o.item_id ORDER BY v.id LIMIT 1),
  o.item_id,
  COALESCE(i.title, 'Item removido'),
  'Padrão',
  o.unit_price_cents,
  o.quantity,
  o.total_cents
FROM orders o
LEFT JOIN items i ON i.id = o.item_id
WHERE NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id);

-- Totais legados: subtotal igual ao total, sem desconto nem frete.
UPDATE orders SET subtotal_cents = total_cents WHERE subtotal_cents IS NULL;
ALTER TABLE orders ALTER COLUMN subtotal_cents SET NOT NULL;

-- Pedidos legados já pagos são considerados com estoque baixado.
UPDATE orders SET stock_committed = TRUE WHERE status = 'paid' AND NOT stock_committed;

-- Pedidos antigos passam a aceitar o novo conjunto de status.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'paid', 'cancelled', 'expired', 'refunded'));

-- As colunas item_id/quantity/unit_price_cents ficam apenas como histórico legado.
ALTER TABLE orders ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE orders ALTER COLUMN quantity DROP NOT NULL;
ALTER TABLE orders ALTER COLUMN unit_price_cents DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_expiring ON orders(expires_at)
  WHERE status = 'pending' AND NOT stock_released;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_mp_payment ON orders(mp_payment_id)
  WHERE mp_payment_id IS NOT NULL;
