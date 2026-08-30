import { db, pool, withTransaction } from "../../src/infra/db/pool";
import { runMigrations } from "../../src/infra/db/migrator";
import { createUser } from "../../src/repositories/users.repo";
import { createItem, createVariant } from "../../src/repositories/items.repo";
import { User } from "../../src/domain/types";

let migrated = false;

/** Aplica as migrations uma única vez por execução da suíte. */
export async function ensureSchema(): Promise<void> {
  if (migrated) return;
  await runMigrations();
  migrated = true;
}

/**
 * Zera as tabelas transacionais entre os testes.
 * `shipping_rates` é preservada porque é dado de referência criado pela migration.
 */
export async function resetData(): Promise<void> {
  await db.execute(`
    TRUNCATE TABLE
      order_items, orders, cart_items, carts, item_variants, items,
      coupons, processed_webhooks, broadcast_targets, broadcasts,
      sessions, cep_cache, users
    RESTART IDENTITY CASCADE
  `);
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

let nextUserId = 900_000;

export async function seedUser(overrides: Partial<{ state: string; zipCode: string }> = {}) {
  const id = nextUserId++;
  return createUser({
    id,
    name: `Cliente ${id}`,
    cpf: String(id).padStart(11, "0"),
    phone: "11999999999",
    zipCode: overrides.zipCode ?? "01001000",
    street: "Praça da Sé",
    number: "100",
    complement: null,
    neighborhood: "Sé",
    city: "São Paulo",
    state: overrides.state ?? "SP",
  });
}

/** Cria um item com uma única variação e o estoque informado. */
export async function seedProduct(options: { priceCents: number; stock: number; title?: string }) {
  const item = await createItem({
    title: options.title ?? "Produto de teste",
    description: "Descrição de teste",
    photoFileId: null,
    priceCents: options.priceCents,
    createdBy: 1,
  });

  const variant = await createVariant({
    itemId: item.id,
    name: "Padrão",
    priceCents: null,
    stock: options.stock,
  });

  return { item, variant };
}

export async function variantStock(variantId: number) {
  const row = await db.queryOne<{ stock: number; reserved: number }>(
    "SELECT stock, reserved FROM item_variants WHERE id = $1",
    [variantId]
  );
  return row!;
}

export async function setShippingRate(state: string, priceCents: number): Promise<void> {
  await db.execute(
    `INSERT INTO shipping_rates (state, price_cents, days_min, days_max)
     VALUES ($1, $2, 3, 7)
     ON CONFLICT (state) DO UPDATE SET price_cents = EXCLUDED.price_cents`,
    [state, priceCents]
  );
}

/** Força um pedido pendente a parecer expirado, sem esperar o TTL real. */
export async function expireOrder(orderId: number): Promise<void> {
  await db.execute("UPDATE orders SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [
    orderId,
  ]);
}

export async function orderStatus(orderId: number): Promise<string | undefined> {
  const row = await db.queryOne<{ status: string }>("SELECT status FROM orders WHERE id = $1", [
    orderId,
  ]);
  return row?.status;
}

export { withTransaction, db };
export type { User };
