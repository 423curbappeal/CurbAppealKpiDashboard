import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { __ceoSql?: postgres.Sql; __ceoDb?: Database };

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  return url;
}

/** Privileged connection. Use ONLY for auth, bootstrap, migrations and account deletion. */
export function adminDb(): Database {
  if (!globalForDb.__ceoDb) {
    globalForDb.__ceoSql = postgres(connectionString(), { max: 10, prepare: false });
    globalForDb.__ceoDb = drizzle(globalForDb.__ceoSql, { schema });
  }
  return globalForDb.__ceoDb;
}

export interface TenantContext {
  userId: string;
  orgId: string;
}

/**
 * Runs `fn` inside a transaction restricted by Postgres row-level security to a
 * single user in a single organization. All domain reads and writes go through here.
 */
export async function withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!ctx.userId || !ctx.orgId) throw new Error("Tenant context is incomplete");
  return adminDb().transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.org_id', ${ctx.orgId}, true), set_config('app.user_id', ${ctx.userId}, true)`,
    );
    await tx.execute(sql`set local role ceo_os_app`);
    return fn(tx);
  });
}

export async function closeDb() {
  await globalForDb.__ceoSql?.end({ timeout: 5 });
  globalForDb.__ceoSql = undefined;
  globalForDb.__ceoDb = undefined;
}

export { schema };
