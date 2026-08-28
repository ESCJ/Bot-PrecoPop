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
    title,
    description,
    photoUrl,
    priceCents,
    stock,
    createdBy
  );
  return (await findItemById(result.lastID as number)) as Item;
}

export async function findItemById(id: number): Promise<Item | undefined> {
  const db = await getDb();
  return db.get<Item>("SELECT * FROM items WHERE id = ?", id);
}

export async function listActiveItems(): Promise<Item[]> {
  const db = await getDb();
  return db.all<Item[]>(
    "SELECT * FROM items WHERE active = 1 AND sold_out = 0 ORDER BY created_at DESC"
  );
}

export async function listAllItems(): Promise<Item[]> {
  const db = await getDb();
  return db.all<Item[]>("SELECT * FROM items ORDER BY created_at DESC");
}

export async function markItemAsSoldOut(id: number): Promise<void> {
  const db = await getDb();
  await db.run(
    "UPDATE items SET sold_out = 1, active = 0 WHERE id = ?",
    id
  );
}

export async function relaunchItem(
  id: number,
  newStock: number
): Promise<void> {
  const db = await getDb();
  await db.run(
    "UPDATE items SET stock = ?, sold_out = 0, active = 1 WHERE id = ?",
    newStock,
    id
  );
}

export async function decrementStock(id: number, quantity: number): Promise<void> {
  const db = await getDb();
  await db.run("UPDATE items SET stock = stock - ? WHERE id = ?", quantity, id);
}

export function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
