# purePSF

Singapore property visualization focused on **real transaction prices** (not asking prices).
Map view of URA private sales + HDB resale, with PSF comparisons against nearby projects.

> Independent project. Data sourced from URA and HDB under the
> [Singapore Open Data Licence](https://www.ura.gov.sg/ms/eservices/Maps/acceptance-grant-licence).
> Not affiliated with or endorsed by URA, HDB, or any government agency.

## Architecture

```
┌──────────┐    ┌──────────────────────────────┐    ┌──────────────┐    ┌────────────┐
│ URA API  │ →  │ Python ETL (httpx + psycopg) │ →  │ Postgres 16  │ ←  │ Go backend │ → browser
│ HDB API  │    │ • ura_transactions           │    │ + PostGIS 3  │    │ chi + pgx  │
│ OneMap   │    │ • hdb_resale (+ geocode)     │    │              │    │            │
└──────────┘    └──────────────────────────────┘    └──────────────┘    └────────────┘
                                                                              │
                                                                              ↓
                                                                       React + Vite +
                                                                       MapLibre GL JS
```

Python ETL and Go backend are independent processes. Their only shared interface is the Postgres schema.

## Stack

| Layer | Tech |
|---|---|
| ETL | Python 3.12, `httpx`, `psycopg[binary]`, `pyproj` (SVY21↔WGS84), `tenacity` |
| DB | Postgres 16 + PostGIS 3 |
| Backend | Go 1.23, `chi` v5, `pgx` v5 |
| Frontend | React 18 + Vite + TypeScript + Tailwind, MapLibre GL JS, recharts |
| Tiles | OneMap raster (free, official SG) |

## Quickstart

```bash
cp .env.example .env       # fill URA_ACCESS_KEY, ONEMAP_EMAIL/PASSWORD, POSTGRES_PASSWORD
make up                    # postgres (docker) + apply schema
make etl-install           # python venv + install ETL package
cd etl && source ../.env && \
    .venv/bin/purepsf-etl ura-transactions && \
    .venv/bin/purepsf-etl hdb-resale && \
    .venv/bin/purepsf-etl geocode-missing && \
    .venv/bin/purepsf-etl backfill-postal     # offline: reads cached OneMap responses
make verify-db             # data sanity checks
make backend-run &         # Go API on :8080
make smoke-api             # API smoke tests
make frontend-dev          # Vite dev server on :5173
```

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/healthz` | DB ping |
| GET | `/api/projects?bbox=lng1,lat1,lng2,lat2` | Projects within map viewport (≤ 500) |
| GET | `/api/projects/{id}/transactions?from=&to=` | Per-project transaction list |
| GET | `/api/projects/{id}/comparison` | Own avg PSF, 500m-nearby avg PSF (last 24mo), premium % |
| GET | `/api/tracked` | Tracked projects + latest stats |

## Data sources

| Source | Coverage | Update cadence |
|---|---|---|
| URA Data Service `PMI_Resi_Transaction` | Private sales, past 5 years, with SVY21 coords | Tue/Fri |
| data.gov.sg `d_8b84c4ee58e3cfc0ece0d773c8ca6abc` | HDB resale, block + street | Monthly |
| OneMap `/api/common/elastic/search` | HDB block → lat/lng/postcode | On demand (15k/hr) |

## Known limits

- URA Data Service only returns the last 5 years. Older history requires the URA quarterly datasets on data.gov.sg (not yet ingested).
- Developer sales (units launched / sold / unsold) is **not** available via the free Data Service API — only quarterly PDFs. Deferred to v1.
- Tracked projects table is empty until manually seeded (see `infra/seed_tracked.sql`).

## Layout

```
backend/   Go API (chi + pgx)
etl/       Python pipelines (URA, HDB, OneMap)
frontend/  React + Vite + MapLibre
infra/     schema.sql, migrations, seed, verify.sql
scripts/   smoke_api.sh
data/      Local-only working files (gitignored)
```
