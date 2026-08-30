import { db, Queryable } from "../infra/db/pool";
import { User } from "../domain/types";
import { formatAddress } from "../domain/cep";

const COLUMNS = `id, name, cpf, phone, zip_code, street, number, complement,
                 neighborhood, city, state, address, blocked_bot, created_at, updated_at`;

export interface UpsertUserInput {
  id: number;
  name: string;
  cpf: string;
  phone?: string | null;
  zipCode: string;
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
}

function buildAddressCache(input: {
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zipCode: string;
}): string {
  return formatAddress({ ...input, zipCode: input.zipCode });
}

export async function findUserById(id: number, runner: Queryable = db): Promise<User | undefined> {
  return runner.queryOne<User>(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
}

export async function findUserByCpf(
  cpf: string,
  runner: Queryable = db
): Promise<User | undefined> {
  return runner.queryOne<User>(`SELECT ${COLUMNS} FROM users WHERE cpf = $1`, [cpf]);
}

export async function createUser(input: UpsertUserInput, runner: Queryable = db): Promise<User> {
  const address = buildAddressCache(input);
  const row = await runner.queryOne<User>(
    `INSERT INTO users (id, name, cpf, phone, zip_code, street, number, complement,
                        neighborhood, city, state, address, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, cpf = EXCLUDED.cpf, phone = EXCLUDED.phone,
       zip_code = EXCLUDED.zip_code, street = EXCLUDED.street, number = EXCLUDED.number,
       complement = EXCLUDED.complement, neighborhood = EXCLUDED.neighborhood,
       city = EXCLUDED.city, state = EXCLUDED.state, address = EXCLUDED.address,
       blocked_bot = FALSE, updated_at = NOW()
     RETURNING ${COLUMNS}`,
    [
      input.id,
      input.name,
      input.cpf,
      input.phone ?? null,
      input.zipCode,
      input.street,
      input.number,
      input.complement,
      input.neighborhood,
      input.city,
      input.state,
      address,
    ]
  );
  return row!;
}

export type UpdateUserPatch = Partial<{
  name: string;
  phone: string | null;
  zip_code: string;
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
}>;

export async function updateUser(
  id: number,
  patch: UpdateUserPatch,
  runner: Queryable = db
): Promise<User | undefined> {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return findUserById(id, runner);

  const assignments = entries.map(([column], index) => `${column} = $${index + 2}`);
  const values = entries.map(([, value]) => value);

  const updated = await runner.queryOne<User>(
    `UPDATE users SET ${assignments.join(", ")}, updated_at = NOW()
      WHERE id = $1
      RETURNING ${COLUMNS}`,
    [id, ...values]
  );
  if (!updated) return undefined;

  // Mantém o cache textual do endereço em sincronia.
  const address = buildAddressCache({
    street: updated.street,
    number: updated.number,
    complement: updated.complement,
    neighborhood: updated.neighborhood,
    city: updated.city,
    state: updated.state,
    zipCode: updated.zip_code,
  });

  return (
    (await runner.queryOne<User>(
      `UPDATE users SET address = $2 WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, address]
    )) ?? updated
  );
}

export async function markUserBlocked(id: number, blocked: boolean): Promise<void> {
  await db.execute("UPDATE users SET blocked_bot = $2, updated_at = NOW() WHERE id = $1", [
    id,
    blocked,
  ]);
}

export async function listReachableUserIds(): Promise<number[]> {
  const rows = await db.query<{ id: string }>(
    "SELECT id FROM users WHERE NOT blocked_bot ORDER BY id"
  );
  return rows.map((row) => Number(row.id));
}

export async function countUsers(): Promise<{ total: number; reachable: number }> {
  const row = await db.queryOne<{ total: string; reachable: string }>(
    `SELECT COUNT(*)::TEXT AS total,
            COUNT(*) FILTER (WHERE NOT blocked_bot)::TEXT AS reachable
       FROM users`
  );
  return { total: Number(row?.total ?? 0), reachable: Number(row?.reachable ?? 0) };
}
