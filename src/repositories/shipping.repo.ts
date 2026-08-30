import { db } from "../infra/db/pool";
import { ShippingRate } from "../domain/types";

const COLUMNS = `id, state, price_cents, days_min, days_max, active`;

export async function findRateByState(state: string): Promise<ShippingRate | undefined> {
  return db.queryOne<ShippingRate>(
    `SELECT ${COLUMNS} FROM shipping_rates WHERE state = UPPER($1) AND active`,
    [state]
  );
}

export async function listRates(): Promise<ShippingRate[]> {
  return db.query<ShippingRate>(`SELECT ${COLUMNS} FROM shipping_rates ORDER BY state`);
}

export async function upsertRate(input: {
  state: string;
  priceCents: number;
  daysMin: number;
  daysMax: number;
}): Promise<ShippingRate> {
  const row = await db.queryOne<ShippingRate>(
    `INSERT INTO shipping_rates (state, price_cents, days_min, days_max, updated_at)
     VALUES (UPPER($1), $2, $3, $4, NOW())
     ON CONFLICT (state) DO UPDATE
       SET price_cents = EXCLUDED.price_cents,
           days_min = EXCLUDED.days_min,
           days_max = EXCLUDED.days_max,
           active = TRUE,
           updated_at = NOW()
     RETURNING ${COLUMNS}`,
    [input.state, input.priceCents, input.daysMin, input.daysMax]
  );
  return row!;
}

export async function setRateActive(state: string, active: boolean): Promise<void> {
  await db.execute(
    "UPDATE shipping_rates SET active = $2, updated_at = NOW() WHERE state = UPPER($1)",
    [state, active]
  );
}
