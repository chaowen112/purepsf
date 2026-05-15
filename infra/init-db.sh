#!/bin/sh
# Postgres container init: apply base schema then every migration in order.
# Sourced by /docker-entrypoint-initdb.d only on first container start
# (i.e. when the pgdata volume is empty). Idempotent SQL means re-running
# manually via `docker compose exec postgres /sql/init-db.sh` is also safe.
set -eu

psql_run() {
    psql -v ON_ERROR_STOP=1 --no-password \
         -U "${POSTGRES_USER:-purepsf}" \
         -d "${POSTGRES_DB:-purepsf}" \
         -f "$1"
}

echo "[init-db] applying schema.sql"
psql_run /sql/schema.sql

if ls /sql/migrations/*.sql >/dev/null 2>&1; then
    for f in /sql/migrations/*.sql; do
        echo "[init-db] applying $f"
        psql_run "$f"
    done
fi

echo "[init-db] done"
