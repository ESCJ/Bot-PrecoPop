import { db, Queryable } from "../infra/db/pool";
import { CustomerSummary, User } from "../domain/types";
import { formatAddress } from "../domain/cep";

const COLUMNS = `id, name, cpf, phone, zip_code, street, number, complement,
                 neighborhood, city, state, address, blocked_bot, banned_at,
                 created_at, updated_at`;

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

/**
 * Suspende ou reativa o cliente. Diferente de `markUserBlocked`: aqui é uma
 * decisão do administrador, não uma consequência de falha de entrega.
 */
export async function setUserBanned(id: number, banned: boolean): Promise<User | undefined> {
  return db.queryOne<User>(
    `UPDATE users SET banned_at = ${banned ? "NOW()" : "NULL"}, updated_at = NOW()
      WHERE id = $1
      RETURNING ${COLUMNS}`,
    [id]
  );
}

/**
 * Remove o cadastro do cliente. Os pedidos NÃO são apagados: `orders` não tem
 * FK para `users` e guarda o próprio `shipping_snapshot`, então o histórico
 * financeiro continua íntegro nos relatórios depois da remoção.
 */
export async function deleteUser(id: number): Promise<boolean> {
  const removed = await db.execute("DELETE FROM users WHERE id = $1", [id]);
  if (removed > 0) {
    // A sessão do Telegraf usa a chave "<from.id>:<chat.id>"; em conversa
    // privada os dois são o mesmo id.
    await db.execute("DELETE FROM sessions WHERE key = $1", [`${id}:${id}`]);
  }
  return removed > 0;
}

export async function listReachableUserIds(): Promise<number[]> {
  const rows = await db.query<{ id: string }>(
    "SELECT id FROM users WHERE NOT blocked_bot AND banned_at IS NULL ORDER BY id"
  );
  return rows.map((row) => Number(row.id));
}

export async function countUsers(): Promise<{
  total: number;
  reachable: number;
  banned: number;
}> {
  const row = await db.queryOne<{ total: string; reachable: string; banned: string }>(
    `SELECT COUNT(*)::TEXT AS total,
            COUNT(*) FILTER (WHERE NOT blocked_bot AND banned_at IS NULL)::TEXT AS reachable,
            COUNT(*) FILTER (WHERE banned_at IS NOT NULL)::TEXT AS banned
       FROM users`
  );
  return {
    total: Number(row?.total ?? 0),
    reachable: Number(row?.reachable ?? 0),
    banned: Number(row?.banned ?? 0),
  };
}

/* ---------------------------------------------------------------- */
/* Painel administrativo de clientes                                 */
/* ---------------------------------------------------------------- */

export type CustomerFilter = "all" | "buyers" | "banned";

/**
 * Agrega as compras de cada cliente numa subconsulta lateral em vez de
 * consultar pedidos por linha — evita N+1 na listagem paginada.
 */
const CUSTOMER_SELECT = `
  SELECT u.id, u.name, u.cpf, u.phone, u.zip_code, u.street, u.number, u.complement,
         u.neighborhood, u.city, u.state, u.address, u.blocked_bot, u.banned_at,
         u.created_at, u.updated_at,
         COALESCE(s.orders_count, 0)::INT      AS orders_count,
         COALESCE(s.paid_orders_count, 0)::INT AS paid_orders_count,
         COALESCE(s.total_spent_cents, 0)::INT AS total_spent_cents,
         s.last_order_at
    FROM users u
    LEFT JOIN LATERAL (
      SELECT COUNT(*)                                                    AS orders_count,
             COUNT(*) FILTER (WHERE o.status = 'paid')                   AS paid_orders_count,
             COALESCE(SUM(o.total_cents) FILTER (WHERE o.status = 'paid'), 0)
                                                                         AS total_spent_cents,
             MAX(o.created_at)                                           AS last_order_at
        FROM orders o
       WHERE o.user_id = u.id
    ) s ON TRUE`;

function customerFilterClause(filter: CustomerFilter): string {
  if (filter === "banned") return "WHERE u.banned_at IS NOT NULL";
  if (filter === "buyers") return "WHERE COALESCE(s.paid_orders_count, 0) > 0";
  return "";
}

export async function listCustomers(
  filter: CustomerFilter,
  limit: number,
  offset: number
): Promise<CustomerSummary[]> {
  return db.query<CustomerSummary>(
    `${CUSTOMER_SELECT}
     ${customerFilterClause(filter)}
     ORDER BY u.created_at DESC, u.id DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
}

export async function countCustomers(filter: CustomerFilter): Promise<number> {
  const row = await db.queryOne<{ count: string }>(
    `SELECT COUNT(*)::TEXT AS count FROM (${CUSTOMER_SELECT} ${customerFilterClause(filter)}) q`
  );
  return Number(row?.count ?? 0);
}

export async function findCustomerSummary(id: number): Promise<CustomerSummary | undefined> {
  return db.queryOne<CustomerSummary>(`${CUSTOMER_SELECT} WHERE u.id = $1`, [id]);
}
