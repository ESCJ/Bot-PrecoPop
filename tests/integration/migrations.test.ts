import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { closeDatabase, db, ensureSchema, resetData, seedProduct, seedUser } from "./helpers";
import { getOrCreateCartId } from "../../src/repositories/carts.repo";
import { createUser, findUserById } from "../../src/repositories/users.repo";

/** Colunas que guardam id de usuário do Telegram e por isso precisam de BIGINT. */
const TELEGRAM_ID_COLUMNS: ReadonlyArray<[table: string, column: string]> = [
  ["users", "id"],
  ["items", "created_by"],
  ["orders", "user_id"],
  ["carts", "user_id"],
  ["coupons", "created_by"],
  ["broadcasts", "created_by"],
  ["broadcast_targets", "user_id"],
];

function migrationSql(file: string): string {
  return readFileSync(join("src", "infra", "db", "migrations", file), "utf8");
}

async function columnType(table: string, column: string): Promise<string | undefined> {
  const row = await db.queryOne<{ data_type: string }>(
    `SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return row?.data_type;
}

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

  describe("Ids do Telegram acima de 2^31", () => {
    // Regressao: contas novas do Telegram passam de 2.147.483.647. Com as
    // colunas em INTEGER, o /start desses usuarios morria em
    // "value ... is out of range for type integer".
    const BIG_TELEGRAM_ID = 8_601_816_429;

    /** Cria pelo caminho real do cadastro, respeitando todas as constraints. */
    function createBigUser() {
      return createUser({
        id: BIG_TELEGRAM_ID,
        name: "Usuário Novo",
        cpf: "39053344705",
        phone: "11999999999",
        zipCode: "01001000",
        street: "Praça da Sé",
        number: "1",
        complement: null,
        neighborhood: "Sé",
        city: "São Paulo",
        state: "SP",
      });
    }

    it("declara BIGINT em toda coluna que guarda id de usuário", async () => {
      for (const [table, column] of TELEGRAM_ID_COLUMNS) {
        expect(await columnType(table, column), `${table}.${column} deveria ser bigint`).toBe(
          "bigint"
        );
      }
    });

    it("cadastra um usuário com id acima do limite do integer", async () => {
      const created = await createBigUser();

      expect(created.id).toBe(BIG_TELEGRAM_ID);
      expect((await findUserById(BIG_TELEGRAM_ID))?.id).toBe(BIG_TELEGRAM_ID);
    });

    it("converte um banco legado que ainda esteja em INTEGER", async () => {
      // Reproduz o estado real de producao: o schema declarava BIGINT, mas o
      // CREATE TABLE IF NOT EXISTS nunca corrigiu a coluna que ja existia.
      await db.execute("ALTER TABLE users ALTER COLUMN id TYPE INTEGER");
      expect(await columnType("users", "id")).toBe("integer");

      // Antes da migration, o /start desse usuario falhava aqui.
      await expect(createBigUser()).rejects.toThrow(/out of range/i);

      await db.execute(migrationSql("011_bigint_user_ids.sql"));

      expect(await columnType("users", "id")).toBe("bigint");
      expect((await createBigUser()).id).toBe(BIG_TELEGRAM_ID);
    });

    it("é idempotente quando o banco já está correto", async () => {
      await db.execute(migrationSql("011_bigint_user_ids.sql"));
      await db.execute(migrationSql("011_bigint_user_ids.sql"));

      expect(await columnType("users", "id")).toBe("bigint");
    });

    it("devolve BIGINT como número, não como string", async () => {
      // O driver pg devolve int8 como string por padrão. Sem o type parser,
      // user.id nunca bateria com o id que o Telegram envia e todo SUM() do
      // relatório de faturamento viraria concatenação de texto.
      await createBigUser();

      const user = await findUserById(BIG_TELEGRAM_ID);
      expect(typeof user?.id).toBe("number");

      const row = await db.queryOne<{ total: number }>("SELECT COUNT(*) AS total FROM users");
      expect(typeof row?.total).toBe("number");
      expect(row?.total).toBe(1);
    });
  });
});
