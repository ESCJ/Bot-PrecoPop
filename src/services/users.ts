import { getDb } from "../db";
import { User } from "../types";

export async function findUserById(id: number): Promise<User | undefined> {
  const db = await getDb();
  return db.get<User>("SELECT * FROM users WHERE id = ?", id);
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
    id,
    name,
    cpf,
    address,
    zipCode
  );
  return (await findUserById(id)) as User;
}

export async function listAllUserIds(): Promise<number[]> {
  const db = await getDb();
  const rows = await db.all<{ id: number }[]>("SELECT id FROM users");
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
