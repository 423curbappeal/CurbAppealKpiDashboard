#!/usr/bin/env bash
# Integration check against disposable synthetic PostgreSQL data only.
# Never connect this script to an actual CEO OS database.
set -euo pipefail
: "${TEST_PG_HOST:?Set TEST_PG_HOST for a disposable local PostgreSQL server}"
: "${TEST_PG_USER:?Set TEST_PG_USER}"
: "${TEST_PG_PASSWORD:?Set TEST_PG_PASSWORD}"
if [[ "${CEO_OS_TEST_MODE:-}" != "synthetic-fixtures-only" ]]; then
  echo "Refusing: synthetic-fixtures-only mode is required." >&2
  exit 2
fi
if [[ "${TEST_PG_HOST}" != "localhost" && "${TEST_PG_HOST}" != "127.0.0.1" ]]; then
  echo "Refusing to connect to a remote database." >&2
  exit 2
fi
export PGHOST="$TEST_PG_HOST" PGUSER="$TEST_PG_USER" PGPASSWORD="$TEST_PG_PASSWORD"
export PGPORT="${TEST_PG_PORT:-5432}"
export PGCONNECT_TIMEOUT=5
SOURCE=ceo_os_backup_fixture
RESTORED=ceo_os_backup_restored
tempdir="$(mktemp -d)"
source_created=0
restored_created=0
cleanup() {
  rm -rf "$tempdir"
  # Only ever drop the hard-coded synthetic test database names.
  if [[ "$source_created" -eq 1 ]]; then dropdb --if-exists "$SOURCE" >/dev/null 2>&1 || true; fi
  if [[ "$restored_created" -eq 1 ]]; then dropdb --if-exists "$RESTORED" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
# Prevent unexpected deletion when a previous test was interrupted.
for db in "$SOURCE" "$RESTORED"; do
  if psql -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1; then
    echo "Refusing: disposable database $db already exists. Inspect it before cleanup." >&2
    exit 2
  fi
done
createdb "$SOURCE"
source_created=1
createdb "$RESTORED"
restored_created=1
psql -X -v ON_ERROR_STOP=1 -d "$SOURCE" <<'SQL'
CREATE TABLE ceo_os_state(id integer PRIMARY KEY, revision bigint, payload jsonb);
CREATE TABLE ceo_passkeys(credential_id text PRIMARY KEY, public_key bytea, sign_count bigint);
CREATE TABLE ceo_sessions(token_hash text PRIMARY KEY, expires_at bigint, auth_method text);
CREATE TABLE ceo_recovery_attempts(bucket text PRIMARY KEY, failures integer, window_started bigint);
CREATE TABLE ceo_plaid_sandbox(item_id text PRIMARY KEY, token_cipher bytea, cursor text, transactions jsonb);
CREATE TABLE ceo_plaid_sandbox_rules(rule_key text PRIMARY KEY, choice text);
CREATE TABLE ceo_plaid_live(item_id text PRIMARY KEY, token_cipher bytea, cursor text, transactions jsonb);
CREATE TABLE ceo_plaid_live_rules(rule_key text PRIMARY KEY, choice text);
INSERT INTO ceo_os_state VALUES (1,42,'{"tasks":[{"id":"synthetic","text":"test restore"}]}'::jsonb);
INSERT INTO ceo_passkeys VALUES ('fake-id',decode('aabbcc','hex'),2);
INSERT INTO ceo_sessions VALUES ('fake-session-hash',9999999999,'passkey');
INSERT INTO ceo_recovery_attempts VALUES ('fake-attempt-hash',1,1700000000);
INSERT INTO ceo_plaid_sandbox VALUES ('fake-sandbox',decode('0102','hex'),'test-cursor','{"test":{"amount":1}}'::jsonb);
INSERT INTO ceo_plaid_sandbox_rules VALUES ('merchant:test','Shopping');
INSERT INTO ceo_plaid_live VALUES ('fake-live',decode('0304','hex'),'live-cursor','{"test":{"amount":5}}'::jsonb);
INSERT INTO ceo_plaid_live_rules VALUES ('tx:test','Food & drink');
SQL

pg_dump -Fc --no-owner --no-acl --file="$tempdir/synthetic.backup" "$SOURCE"
pg_restore --exit-on-error --no-owner --no-acl --dbname="$RESTORED" "$tempdir/synthetic.backup"
# Compare all data, not merely that the dump can be opened.
for table in ceo_os_state ceo_passkeys ceo_sessions ceo_recovery_attempts \
  ceo_plaid_sandbox ceo_plaid_sandbox_rules ceo_plaid_live ceo_plaid_live_rules; do
  first="$(psql -X -d "$SOURCE" -Atqc "SELECT md5(string_agg(row_to_json(t)::text, ',' ORDER BY row_to_json(t)::text)) FROM (SELECT * FROM $table) t")"
  second="$(psql -X -d "$RESTORED" -Atqc "SELECT md5(string_agg(row_to_json(t)::text, ',' ORDER BY row_to_json(t)::text)) FROM (SELECT * FROM $table) t")"
  if [[ -z "$first" || "$first" != "$second" ]]; then
    echo "Restore mismatch for $table" >&2
    exit 1
  fi
done
echo "Synthetic PostgreSQL backup and restore passed for 8 CEO OS tables."
