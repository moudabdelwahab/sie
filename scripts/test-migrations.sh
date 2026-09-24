#!/usr/bin/env bash
# Applies the SIE migrations that the edition work touches to a THROWAWAY
# local Postgres and runs sie-integration/tests/sql/editions-migration.test.sql.
#
#   PGURL=postgres://user@host:port/db scripts/test-migrations.sh
#
# The database named by PGURL is dropped and recreated as `sie_migration_test`
# on that server. Never point it at a real project.
set -euo pipefail
: "${PGURL:?set PGURL to a scratch Postgres server}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADMIN_URL="${PGURL%/*}/postgres"
psql -q "$ADMIN_URL" -c 'drop database if exists sie_migration_test' -c 'create database sie_migration_test'
DB="${PGURL%/*}/sie_migration_test"
psql -q -v ON_ERROR_STOP=1 "$DB" -f "$ROOT/sie-integration/tests/sql/supabase-stubs.sql"
psql -q -v ON_ERROR_STOP=1 "$DB" -f "$ROOT/sie-integration/migrations/0008_add_api_rate_limiting.sql"
psql -q -v ON_ERROR_STOP=1 "$DB" -f "$ROOT/sie-integration/tests/sql/production-2026-09-24.sql"
# Baseline: the deployed functions before 0009, for the before/after checks.
psql -q -v ON_ERROR_STOP=1 "$DB" -f "$ROOT/sie-integration/tests/sql/baseline-before-0009.sql"
psql -q -v ON_ERROR_STOP=1 "$DB" -f "$ROOT/sie-integration/migrations/0009_sie_editions.sql"
psql -q -v ON_ERROR_STOP=1 "$DB" -f "$ROOT/sie-integration/tests/sql/editions-migration.test.sql" 2>&1 | grep -E "ok  |FAIL|ERROR|PASSED"
test "${PIPESTATUS[0]}" -eq 0

# 0010 (owner-only editions), on a second scratch database: the same
# production shape plus the REAL authority functions (Mad3oom 038–053, as
# deployed), which replace the flag-based stubs the 0009 checks use.
psql -q "$ADMIN_URL" -c 'drop database if exists sie_migration_test_0010' -c 'create database sie_migration_test_0010'
DB10="${PGURL%/*}/sie_migration_test_0010"
psql -q -v ON_ERROR_STOP=1 "$DB10" -f "$ROOT/sie-integration/tests/sql/supabase-stubs.sql"
psql -q -v ON_ERROR_STOP=1 "$DB10" -f "$ROOT/sie-integration/migrations/0008_add_api_rate_limiting.sql"
psql -q -v ON_ERROR_STOP=1 "$DB10" -f "$ROOT/sie-integration/tests/sql/production-2026-09-24.sql"
psql -q -v ON_ERROR_STOP=1 "$DB10" -f "$ROOT/sie-integration/migrations/0009_sie_editions.sql"
psql -q -v ON_ERROR_STOP=1 "$DB10" -f "$ROOT/sie-integration/tests/sql/production-authority-2026-09-24.sql"
psql -q -v ON_ERROR_STOP=1 "$DB10" -f "$ROOT/sie-integration/migrations/0010_sie_editions_owner_only.sql"
# Idempotent: applying it twice changes nothing and still passes.
psql -q -v ON_ERROR_STOP=1 "$DB10" -f "$ROOT/sie-integration/migrations/0010_sie_editions_owner_only.sql"
psql -q -v ON_ERROR_STOP=1 "$DB10" -f "$ROOT/sie-integration/tests/sql/owner-editions.test.sql" 2>&1 | grep -E "ok  |FAIL|ERROR|PASSED"
test "${PIPESTATUS[0]}" -eq 0

# 0011 (SIE Free for everyone, self-service downgrade, the customer's
# entitlement), on a third scratch database with the same production shape.
psql -q "$ADMIN_URL" -c 'drop database if exists sie_migration_test_0011' -c 'create database sie_migration_test_0011'
DB11="${PGURL%/*}/sie_migration_test_0011"
for f in tests/sql/supabase-stubs.sql migrations/0008_add_api_rate_limiting.sql tests/sql/production-2026-09-24.sql \
         migrations/0009_sie_editions.sql tests/sql/production-authority-2026-09-24.sql \
         migrations/0010_sie_editions_owner_only.sql migrations/0011_sie_self_service.sql migrations/0011_sie_self_service.sql; do
    psql -q -v ON_ERROR_STOP=1 "$DB11" -f "$ROOT/sie-integration/$f" >/dev/null
done
psql -q -v ON_ERROR_STOP=1 "$DB11" -f "$ROOT/sie-integration/tests/sql/self-service.test.sql" 2>&1 | grep -E "ok  |FAIL|ERROR|PASSED"
test "${PIPESTATUS[0]}" -eq 0
