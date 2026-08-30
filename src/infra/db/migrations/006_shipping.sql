-- Tabela de frete por UF, editável pelo administrador.

CREATE TABLE IF NOT EXISTS shipping_rates (
  id           SERIAL PRIMARY KEY,
  state        TEXT NOT NULL UNIQUE CHECK (LENGTH(state) = 2),
  price_cents  INTEGER NOT NULL CHECK (price_cents >= 0),
  days_min     INTEGER NOT NULL DEFAULT 3 CHECK (days_min >= 0),
  days_max     INTEGER NOT NULL DEFAULT 10 CHECK (days_max >= 0),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shipping_rates_days_order CHECK (days_max >= days_min)
);

-- Tabela inicial por região (valores de partida, ajustáveis no painel admin).
INSERT INTO shipping_rates (state, price_cents, days_min, days_max) VALUES
  ('SP', 1990,  2,  5),
  ('RJ', 2490,  3,  7), ('MG', 2490,  3,  7), ('ES', 2490,  3,  7),
  ('PR', 2690,  4,  8), ('SC', 2690,  4,  8), ('RS', 2690,  4,  9),
  ('GO', 2990,  5, 10), ('DF', 2990,  5, 10), ('MT', 3290,  6, 12), ('MS', 3290,  6, 12),
  ('BA', 3290,  6, 12), ('SE', 3490,  7, 13), ('AL', 3490,  7, 13), ('PE', 3490,  7, 13),
  ('PB', 3490,  7, 13), ('RN', 3490,  7, 13), ('CE', 3490,  7, 14), ('PI', 3690,  8, 15),
  ('MA', 3690,  8, 15), ('TO', 3690,  8, 15), ('PA', 3990,  9, 18), ('AP', 4490, 10, 20),
  ('AM', 4490, 10, 20), ('RR', 4490, 10, 22), ('RO', 4290, 10, 20), ('AC', 4490, 10, 22)
ON CONFLICT (state) DO NOTHING;
