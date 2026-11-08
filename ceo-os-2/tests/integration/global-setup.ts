import postgres from "postgres";
import { runMigrations } from "../../src/db/migrate";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const TEST_DB = "ceo_os_test";

export default async function setup() {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();
  const url = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);
  await runMigrations(url);
  process.env.DATABASE_URL = url;
}
