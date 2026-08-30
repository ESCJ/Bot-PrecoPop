import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, db, ensureSchema, resetData, seedProduct, seedUser } from "./helpers";
import { getOrCreateCartId } from "../../src/repositories/carts.repo";

describe("Migrations", () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    await resetData();
  });

  it("registra todas as migrations aplicadas", async () => {
    const rows = await db.query<{ name: string }>(
      "SELECT name FROM schema_migrations ORDER BY name"
    );
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows[0]!.name).toBe("001_baseline.sql");
  });

  it("cria todas as tabelas do domínio", async () => {
    const expected = [
      "broadcast_targets",
      "broadcasts",
      "cart_items",
      "carts",
      "cep_cache",
      "coupons",
      "item_variants",
      "items",
      "order_items",
      "orders",
      "processed_webhooks",
      "schema_migrations",
      "sessions",
      "shipping_rates",
      "users",
    ];

    const rows = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    const present = new Set(rows.map((row) => row.table_name));

    for (const table of expected) {
      expect(present.has(table), `tabela ausente: ${table}`).toBe(true);
    }
  });

  it("cria os índices críticos de consulta", async () => {
    const rows = await db.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'"
    );
    const present = new Set(rows.map((row) => row.indexname));

    for (const index of [
      "idx_orders_user_status",
      "idx_orders_mp_payment",
      "idx_cart_items_cart",
      "idx_item_variants_item",
    ]) {
      expect(present.has(index), `índice ausente: ${index}`).toBe(true);
    }
  });

  it("mantém as tarifas de frete semeadas pela migration", async () => {
    const row = await db.queryOne<{ count: string }>(
      "SELECT COUNT(*)::TEXT AS count FROM shipping_rates"
    );
    expect(Number(row!.count)).toBeGreaterThan(20);
  });

  it("impede que a reserva ultrapasse o estoque físico", async () => {
    const { variant } = await seedProduct({ priceCents: 1_000, stock: 2 });

    await expect(
      db.execute("UPDATE item_variants SET reserved = 5 WHERE id = $1", [variant.id])
    ).rejects.toThrow(/item_variants_reserved_within_stock/);
  });

  it("impede quantidade zero ou negativa no carrinho", async () => {
    const user = await seedUser();
    const { variant } = await seedProduct({ priceCents: 1_000, stock: 5 });
    const cartId = await getOrCreateCartId(user.id);

    await expect(
      db.execute("INSERT INTO cart_items (cart_id, variant_id, quantity) VALUES ($1, $2, 0)", [
        cartId,
        variant.id,
      ])
    ).rejects.toThrow(/quantity/);
  });
});
