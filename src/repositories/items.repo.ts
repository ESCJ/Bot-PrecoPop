import { db, Queryable } from "../infra/db/pool";
import { Item, ItemVariant, ItemWithStock, VariantWithItem } from "../domain/types";

const ITEM_COLUMNS = `id, title, description, photo_file_id, price_cents, active,
                      created_by, created_at, updated_at`;

const ITEM_WITH_STOCK = `
  SELECT i.id, i.title, i.description, i.photo_file_id, i.price_cents, i.active,
         i.created_by, i.created_at, i.updated_at,
         COALESCE(SUM(v.stock) FILTER (WHERE v.active), 0)::INT              AS total_stock,
         COALESCE(SUM(v.stock - v.reserved) FILTER (WHERE v.active), 0)::INT AS total_available,
         COUNT(v.id) FILTER (WHERE v.active)::INT                            AS variant_count,
         COALESCE(MIN(COALESCE(v.price_cents, i.price_cents)) FILTER (WHERE v.active),
                  i.price_cents)::INT                                        AS min_price_cents,
         COALESCE(MAX(COALESCE(v.price_cents, i.price_cents)) FILTER (WHERE v.active),
                  i.price_cents)::INT                                        AS max_price_cents
    FROM items i
    LEFT JOIN item_variants v ON v.item_id = i.id`;

export async function createItem(
  input: {
    title: string;
    description: string;
    photoFileId: string | null;
    priceCents: number;
    createdBy: number;
  },
  runner: Queryable = db
): Promise<Item> {
  const row = await runner.queryOne<Item>(
    `INSERT INTO items (title, description, photo_file_id, price_cents, created_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING ${ITEM_COLUMNS}`,
    [input.title, input.description, input.photoFileId, input.priceCents, input.createdBy]
  );
  return row!;
}

export type UpdateItemPatch = Partial<{
  title: string;
  description: string;
  photo_file_id: string | null;
  price_cents: number;
  active: boolean;
}>;

export async function updateItem(
  id: number,
  patch: UpdateItemPatch,
  runner: Queryable = db
): Promise<Item | undefined> {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return findItemById(id, runner);

  const assignments = entries.map(([column], index) => `${column} = $${index + 2}`);
  return runner.queryOne<Item>(
    `UPDATE items SET ${assignments.join(", ")}, updated_at = NOW()
      WHERE id = $1 RETURNING ${ITEM_COLUMNS}`,
    [id, ...entries.map(([, value]) => value)]
  );
}

export async function deleteItem(id: number): Promise<void> {
  await db.execute("DELETE FROM items WHERE id = $1", [id]);
}

export async function findItemById(id: number, runner: Queryable = db): Promise<Item | undefined> {
  return runner.queryOne<Item>(`SELECT ${ITEM_COLUMNS} FROM items WHERE id = $1`, [id]);
}

export async function findItemWithStock(id: number): Promise<ItemWithStock | undefined> {
  return db.queryOne<ItemWithStock>(`${ITEM_WITH_STOCK} WHERE i.id = $1 GROUP BY i.id`, [id]);
}

/** Itens visíveis na vitrine: ativos e com pelo menos uma unidade disponível. */
export async function listAvailableItems(limit: number, offset: number): Promise<ItemWithStock[]> {
  return db.query<ItemWithStock>(
    `${ITEM_WITH_STOCK}
      WHERE i.active
      GROUP BY i.id
     HAVING COALESCE(SUM(v.stock - v.reserved) FILTER (WHERE v.active), 0) > 0
      ORDER BY i.created_at DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
}

export async function countAvailableItems(): Promise<number> {
  const row = await db.queryOne<{ count: string }>(
    `SELECT COUNT(*)::TEXT AS count FROM (
       SELECT i.id
         FROM items i
         LEFT JOIN item_variants v ON v.item_id = i.id
        WHERE i.active
        GROUP BY i.id
       HAVING COALESCE(SUM(v.stock - v.reserved) FILTER (WHERE v.active), 0) > 0
     ) AS available`
  );
  return Number(row?.count ?? 0);
}

export async function listAllItems(limit: number, offset: number): Promise<ItemWithStock[]> {
  return db.query<ItemWithStock>(
    `${ITEM_WITH_STOCK} GROUP BY i.id ORDER BY i.created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
}

export async function countAllItems(): Promise<number> {
  const row = await db.queryOne<{ count: string }>("SELECT COUNT(*)::TEXT AS count FROM items");
  return Number(row?.count ?? 0);
}

/* ------------------------------------------------------------------ */
/* Variações                                                           */
/* ------------------------------------------------------------------ */

const VARIANT_JOIN = `
  SELECT v.id, v.item_id, v.name, v.sku, v.price_cents, v.stock, v.reserved, v.active,
         i.title              AS item_title,
         i.description        AS item_description,
         i.photo_file_id      AS photo_file_id,
         i.active             AS item_active,
         COALESCE(v.price_cents, i.price_cents)::INT AS effective_price_cents,
         (v.stock - v.reserved)::INT                 AS available
    FROM item_variants v
    JOIN items i ON i.id = v.item_id`;

export async function createVariant(
  input: {
    itemId: number;
    name: string;
    priceCents: number | null;
    stock: number;
    sku?: string | null;
  },
  runner: Queryable = db
): Promise<ItemVariant> {
  const row = await runner.queryOne<ItemVariant>(
    `INSERT INTO item_variants (item_id, name, price_cents, stock, sku, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING id, item_id, name, sku, price_cents, stock, reserved, active`,
    [input.itemId, input.name, input.priceCents, input.stock, input.sku ?? null]
  );
  return row!;
}

export async function listVariantsByItem(itemId: number): Promise<VariantWithItem[]> {
  return db.query<VariantWithItem>(`${VARIANT_JOIN} WHERE v.item_id = $1 ORDER BY v.id`, [itemId]);
}

export async function listAvailableVariantsByItem(itemId: number): Promise<VariantWithItem[]> {
  return db.query<VariantWithItem>(
    `${VARIANT_JOIN}
      WHERE v.item_id = $1 AND v.active AND i.active AND (v.stock - v.reserved) > 0
      ORDER BY v.id`,
    [itemId]
  );
}

export async function findVariantById(
  id: number,
  runner: Queryable = db
): Promise<VariantWithItem | undefined> {
  return runner.queryOne<VariantWithItem>(`${VARIANT_JOIN} WHERE v.id = $1`, [id]);
}

export type UpdateVariantPatch = Partial<{
  name: string;
  price_cents: number | null;
  stock: number;
  active: boolean;
  sku: string | null;
}>;

export async function updateVariant(
  id: number,
  patch: UpdateVariantPatch,
  runner: Queryable = db
): Promise<void> {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;

  const assignments = entries.map(([column], index) => `${column} = $${index + 2}`);
  await runner.execute(
    `UPDATE item_variants SET ${assignments.join(", ")}, updated_at = NOW() WHERE id = $1`,
    [id, ...entries.map(([, value]) => value)]
  );
}

export async function deleteVariant(id: number): Promise<void> {
  await db.execute("DELETE FROM item_variants WHERE id = $1", [id]);
}

/**
 * Trava as variações informadas para atualização, na ordem do id.
 * A ordenação estável evita deadlock quando dois checkouts concorrem
 * pelos mesmos produtos.
 */
export async function lockVariants(
  tx: Queryable,
  variantIds: number[]
): Promise<Map<number, VariantWithItem>> {
  if (variantIds.length === 0) return new Map();

  const rows = await tx.query<VariantWithItem>(
    `SELECT v.id, v.item_id, v.name, v.sku, v.price_cents, v.stock, v.reserved, v.active,
            i.title AS item_title, i.description AS item_description,
            i.photo_file_id, i.active AS item_active,
            COALESCE(v.price_cents, i.price_cents)::INT AS effective_price_cents,
            (v.stock - v.reserved)::INT AS available
       FROM item_variants v
       JOIN items i ON i.id = v.item_id
      WHERE v.id = ANY($1::int[])
      ORDER BY v.id
        FOR UPDATE OF v`,
    [variantIds]
  );

  return new Map(rows.map((row) => [row.id, row]));
}

export async function reserveStock(tx: Queryable, variantId: number, qty: number): Promise<void> {
  await tx.execute(
    "UPDATE item_variants SET reserved = reserved + $2, updated_at = NOW() WHERE id = $1",
    [variantId, qty]
  );
}

export async function releaseStock(tx: Queryable, variantId: number, qty: number): Promise<void> {
  await tx.execute(
    "UPDATE item_variants SET reserved = GREATEST(reserved - $2, 0), updated_at = NOW() WHERE id = $1",
    [variantId, qty]
  );
}

/** Confirma a venda: baixa o estoque físico e libera a reserva. */
export async function commitStock(tx: Queryable, variantId: number, qty: number): Promise<void> {
  await tx.execute(
    `UPDATE item_variants
        SET stock = GREATEST(stock - $2, 0),
            reserved = GREATEST(reserved - $2, 0),
            updated_at = NOW()
      WHERE id = $1`,
    [variantId, qty]
  );
}
