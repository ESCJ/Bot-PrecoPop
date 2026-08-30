import { getDb } from "../db";
import { Item } from "../types";

export async function createItem(
  title: string,
  description: string,
  photoUrl: string | null,
  priceCents: number,
  stock: number,
  createdBy: number
): Promise<Item> {
  const db = await getDb();
  const result = await db.run(
    "INSERT INTO items (title, description, photo_url, price_cents, stock, created_by) VALUES (?, ?, ?, ?, ?, ?)",
    [title, description, photoUrl, priceCents, stock, createdBy]
  );
  return (await findItemById(result.lastID as number)) as Item;
}

export async function updateItem(
  id: number,
  data: Partial<Pick<Item, "title" | "description" | "photo_url" | "price_cents" | "stock">>
): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const values: any[] = [];

  if (data.title !== undefined) {
    fields.push("title = ?");
    values.push(data.title);
  }
  if (data.description !== undefined) {
    fields.push("description = ?");
    values.push(data.description);
  }
  if (data.photo_url !== undefined) {
    fields.push("photo_url = ?");
    values.push(data.photo_url);
  }
  if (data.price_cents !== undefined) {
    fields.push("price_cents = ?");
    values.push(data.price_cents);
  }
  if (data.stock !== undefined) {
    fields.push("stock = ?");
    values.push(data.stock);
  }

  if (fields.length === 0) return;
  values.push(id);

  await db.run(`UPDATE items SET ${fields.join(", ")} WHERE id = ?`, values);
}

export async function deleteItem(id: number): Promise<void> {
  const db = await getDb();
  await db.run("DELETE FROM items WHERE id = ?", [id]);
}

export async function findItemById(id: number): Promise<Item | undefined> {
  const db = await getDb();
  const rows = await db.query<Item>("SELECT * FROM items WHERE id = ?", [id]);
  return rows[0];
}

export async function listActiveItems(): Promise<Item[]> {
  const db = await getDb();
  return db.query<Item>(
    "SELECT * FROM items WHERE active = TRUE AND sold_out = FALSE ORDER BY created_at DESC"
  );
}

export async function listAllItems(): Promise<Item[]> {
  const db = await getDb();
  return db.query<Item>("SELECT * FROM items ORDER BY created_at DESC");
}

export async function markItemAsSoldOut(id: number): Promise<void> {
  const db = await getDb();
  await db.run(
    "UPDATE items SET sold_out = TRUE, active = FALSE WHERE id = ?",
    [id]
  );
}

export async function relaunchItem(
  id: number,
  newStock: number
): Promise<void> {
  const db = await getDb();
  await db.run(
    "UPDATE items SET stock = ?, sold_out = FALSE, active = TRUE WHERE id = ?",
    [newStock, id]
  );
}

export async function decrementStock(id: number, quantity: number): Promise<void> {
  const db = await getDb();
  await db.run("UPDATE items SET stock = stock - ? WHERE id = ?", [quantity, id]);
}

export function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
