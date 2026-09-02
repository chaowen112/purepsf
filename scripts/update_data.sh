#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
    echo "missing .env; copy .env.example and fill the required credentials" >&2
    exit 1
fi

compose=(docker compose --profile etl)

"${compose[@]}" build etl

# Live feeds used by the map, property pages, comparisons and agent views.
"${compose[@]}" run --rm etl ura-transactions
"${compose[@]}" run --rm etl hdb-property-info
"${compose[@]}" run --rm etl hdb-resale
"${compose[@]}" run --rm etl geocode-missing
"${compose[@]}" run --rm etl backfill-postal
"${compose[@]}" run --rm etl refresh-tenure
"${compose[@]}" run --rm etl cea-salespeople
"${compose[@]}" run --rm etl cea-transactions

make verify-data
