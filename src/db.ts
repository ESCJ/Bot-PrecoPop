import { Client as PgClient, QueryResult } from "pg";
import sqlite3 from "sqlite3";
import { open, Database as SqliteDatabase } from "sqlite";
import { config } from "./config";
import path from "path";
import fs from "fs";

export interface DbAdapter {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  run(sql: string, params?: any[]): Promise<{ lastID?: number; changes?: number }>;
  exec(sql: string): Promise<void>;
  close?(): Promise<void>;
}

let adapter: DbAdapter | null = null;

export async function getDb(): Promise<DbAdapter> {
  if (adapter) return adapter;

  const dbUrl = config.database.url;

  if (dbUrl.startsWith("postgres://") || dbUrl.startsWith("postgresql://")) {
    adapter = await createPostgresAdapter(dbUrl);
  } else {
    adapter = await createSqliteAdapter(dbUrl);
  }

  await runMigrations(adapter);
  return adapter;
}

async function createPostgresAdapter(dbUrl: string): Promise<DbAdapter> {
  const client = new PgClient({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  return {
    async query<T>(sql: string, params?: any[]): Promise<T[]> {
      const normalizedSql = sql.replace(/\?/g, (_match, offset, string) => {
        let count = 0;
        for (let i = 0; i < offset; i++) {
          if (string[i] === "?") count++;
        }
        return `$${count + 1}`;
      });
      const result: QueryResult = await client.query(normalizedSql, params);
      return result.rows as T[];
    },
    async run(sql: string, params?: any[]) {
      const normalizedSql = sql.replace(/\?/g, (_match, offset, string) => {
        let count = 0;
        for (let i = 0; i < offset; i++) {
          if (string[i] === "?") count++;
        }
        return `$${count + 1}`;
      });
      const result: QueryResult = await client.query(normalizedSql, params);
      return { changes: result.rowCount || 0 };
    },
    async exec(sql: string) {
      // Postgres não suporta exec com múltiplas instruções por padrão; executar separadamente
      const statements = sql
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const statement of statements) {
        await client.query(statement);
      }
    },
    async close() {
      await client.end();
    },
  };
}

async function createSqliteAdapter(dbUrl: string): Promise<DbAdapter> {
  const dbPath = path.resolve(dbUrl);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  await db.exec(`PRAGMA foreign_keys = ON;`);

  return {
    async query<T>(sql: string, params?: any[]): Promise<T[]> {
      return db.all<T[]>(sql, params);
    },
    async run(sql: string, params?: any[]) {
      const result = await db.run(sql, params);
      return { lastID: result.lastID, changes: result.changes };
    },
    async exec(sql: string) {
      await db.exec(sql);
    },
  };
}

function isPostgres(): boolean {
  const dbUrl = config.database.url;
  return dbUrl.startsWith("postgres://") || dbUrl.startsWith("postgresql://");
}

async function runMigrations(db: DbAdapter) {
  const autoIncrement = isPostgres() ? "SERIAL" : "INTEGER";
  const timestamp = isPostgres() ? "TIMESTAMP DEFAULT CURRENT_TIMESTAMP" : "DATETIME DEFAULT CURRENT_TIMESTAMP";
  const boolean = isPostgres() ? "BOOLEAN" : "INTEGER";

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      cpf TEXT NOT NULL UNIQUE,
      address TEXT NOT NULL,
      zip_code TEXT NOT NULL,
      created_at ${timestamp}
    );

    CREATE TABLE IF NOT EXISTS items (
      id ${autoIncrement} PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      photo_url TEXT,
      price_cents INTEGER NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      active ${boolean} NOT NULL DEFAULT TRUE,
      sold_out ${boolean} NOT NULL DEFAULT FALSE,
      created_by INTEGER NOT NULL,
      created_at ${timestamp}
    );

    CREATE TABLE IF NOT EXISTS orders (
      id ${autoIncrement} PRIMARY KEY,
      user_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      total_cents INTEGER NOT NULL,
      payment_method TEXT NOT NULL,
      mp_payment_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      shipped ${boolean} NOT NULL DEFAULT FALSE,
      created_at ${timestamp},
      paid_at ${timestamp}
    );
  `);
}
