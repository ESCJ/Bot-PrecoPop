import { getDb } from "../db";
import { User } from "../types";

export async function findUserById(id: number): Promise<User | undefined> {
  const db = await getDb();
  const rows = await db.query<User>("SELECT * FROM users WHERE id = ?", [id]);
  return rows[0];
}

export async function updateUser(
  id: number,
  data: Partial<Pick<User, "name" | "cpf" | "address" | "zip_code">>
): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const values: any[] = [];

  if (data.name) {
    fields.push("name = ?");
    values.push(data.name);
  }
  if (data.cpf) {
    fields.push("cpf = ?");
    values.push(data.cpf);
  }
  if (data.address) {
    fields.push("address = ?");
    values.push(data.address);
  }
  if (data.zip_code) {
    fields.push("zip_code = ?");
    values.push(data.zip_code);
  }

  if (fields.length === 0) return;
  values.push(id);

  await db.run(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, values);
}

export async function createUser(
  id: number,
  name: string,
  cpf: string,
  address: string,
  zipCode: string
): Promise<User> {
  const db = await getDb();
  await db.run(
    "INSERT INTO users (id, name, cpf, address, zip_code) VALUES (?, ?, ?, ?, ?)",
    [id, name, cpf, address, zipCode]
  );
  return (await findUserById(id)) as User;
}

export async function listAllUserIds(): Promise<number[]> {
  const db = await getDb();
  const rows = await db.query<{ id: number }>("SELECT id FROM users");
  return rows.map((r) => r.id);
}

export function isValidCpf(cpf: string): boolean {
  const cleaned = cpf.replace(/\D/g, "");
  if (cleaned.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cleaned)) return false;

  let sum = 0;
  let remainder: number;
  for (let i = 1; i <= 9; i++) {
    sum += parseInt(cleaned.substring(i - 1, i), 10) * (11 - i);
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(cleaned.substring(9, 10), 10)) return false;

  sum = 0;
  for (let i = 1; i <= 10; i++) {
    sum += parseInt(cleaned.substring(i - 1, i), 10) * (12 - i);
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(cleaned.substring(10, 11), 10)) return false;

  return true;
}

export function isValidCep(cep: string): boolean {
  return /^\d{5}-?\d{3}$/.test(cep.trim());
}

export function formatCpf(cpf: string): string {
  const cleaned = cpf.replace(/\D/g, "");
  return cleaned.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}
