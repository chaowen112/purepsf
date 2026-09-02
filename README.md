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
    .venv/bin/purepsf-etl hdb-property-info && \
    .venv/bin/purepsf-etl hdb-resale && \
    .venv/bin/purepsf-etl geocode-missing && \
    .venv/bin/purepsf-etl backfill-postal && \
    psql "$DATABASE_URL" -f ../infra/migrations/001_planning_subzones.sql && \
    .venv/bin/purepsf-etl planning-subzones --file ../data/mp19_subzones.geojson
make verify-db             # data sanity checks
make backend-run &         # Go API on :8080
make smoke-api             # API smoke tests
make frontend-dev          # Vite dev server on :5173
```

## Refreshing live data

With Postgres running and `.env` populated, refresh every repeatable live feed
used by the current website/API with one command:

```bash
make data-update
```

This rebuilds the one-shot ETL image, updates URA transactions, HDB block
metadata and resale transactions, fills new OneMap coordinates/postcodes,
refreshes derived tenure fields, then updates the CEA salesperson registry and
transaction snapshot. It ends with freshness/count assertions from
`make verify-data`. All loaders are rerunnable; transaction inserts use stable
deduplication keys, metadata uses upserts, and the large CEA snapshot is staged
and table-swapped only after the bulk CSV has loaded and indexed successfully.

The CEA table swap temporarily needs free database storage comparable to the
live `salesperson_transactions` table (allow at least 1 GB of Docker VM free
space at the current dataset size). Planning subzones remain a one-off manual
GeoJSON load. Developer sales is not part of this command: the repository's
parser is still an explicit stub, so monthly figures must not be fabricated or
treated as refreshed until that parser is implemented and a URA workbook is
provided.

## Production deploy (single host)

```bash
cp .env.example .env       # set POSTGRES_PASSWORD, URA_ACCESS_KEY, ONEMAP_* etc.
docker compose up -d       # postgres + backend + nginx (only :80 exposed)
# First time: load polygons, then run ETLs inside the `etl` profile.
docker compose --profile etl run --rm etl ura-transactions
docker compose --profile etl run --rm etl hdb-property-info
docker compose --profile etl run --rm etl hdb-resale
docker compose --profile etl run --rm etl geocode-missing
docker compose --profile etl run --rm etl backfill-postal
docker compose --profile etl run --rm etl planning-subzones --file /data/mp19_subzones.geojson
```

Topology:

```
 host  ─── :80 ───►  nginx (frontend)
                      ├── /assets/*  → static
                      └── /api/* /healthz /p/* → backend:8080  (internal-only network)
                                            └── postgres:5432  (internal-only)
```

Only the frontend publishes a port. Postgres is reachable on `127.0.0.1:5432`
of the host for ad-hoc psql/ETL from outside the container. The `etl` service
is a one-shot runner — `docker compose --profile etl run --rm etl <subcommand>`.

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/healthz` | DB ping |
| GET | `/api/projects?bbox=lng1,lat1,lng2,lat2&property_type=&top_after=&min_price=&max_price=` | Projects within map viewport (≤ 500), optionally filtered by `hdb` / `condo` / `ec` / `landed`, TOP/lease year, and average transaction price |
| GET | `/api/projects/{id}/transactions?from=&to=` | Per-project transaction list |
| GET | `/api/projects/{id}/comparison` | Own avg PSF, 500m-nearby avg PSF (last 24mo), premium % |
| GET | `/p/{id}/{slug}` | Server-rendered property HTML; non-canonical slugs redirect, unknown IDs return HTTP 404 |
| GET | `/api/tracked` | Tracked projects + latest stats |
| GET | `/api/subzones/stats?from=&to=&source=` | GeoJSON FeatureCollection of MP19 subzones with avg PSF per polygon |

## External listing links

`external_project_links` stores manually curated outbound links to listing
portals such as PropertyGuru. These links are used for "available listings"
buttons only; third-party listing contents are not ingested or mirrored.

Example:

```sql
INSERT INTO external_project_links
  (project_id, provider, url_sale, url_rent, url_project, match_method, confidence)
VALUES
  (123, 'propertyguru',
   'https://www.propertyguru.com.sg/project-listings/example-condo-123/sale/1',
   'https://www.propertyguru.com.sg/project-listings/example-condo-123/rent/1',
   'https://www.propertyguru.com.sg/project/example-condo-123',
   'manual', 1.0)
ON CONFLICT (project_id, provider) DO UPDATE
SET url_sale = EXCLUDED.url_sale,
    url_rent = EXCLUDED.url_rent,
    url_project = EXCLUDED.url_project,
    match_method = EXCLUDED.match_method,
    confidence = EXCLUDED.confidence,
    updated_at = now();
```

If no curated PropertyGuru URL exists, the frontend checks PropertyGuru's
autocomplete endpoint and only shows sale/rent buttons for an exact project or
HDB block match. It does not fall back to broad free-text search links. If only
a PropertyGuru project URL is curated, the frontend derives the corresponding
`project-listings/.../sale/1` and `project-listings/.../rent/1` available-unit
links.

## Data sources

| Source | Coverage | Update cadence |
|---|---|---|
| URA Data Service `PMI_Resi_Transaction` | Private sales, past 5 years, with SVY21 coords | Tue/Fri |
| data.gov.sg `d_17f5382f26140b1fdae0ba2ef6239d2f` | HDB block metadata: completion year, floor count, dwelling/rental unit mix | Periodic |
| data.gov.sg `d_8b84c4ee58e3cfc0ece0d773c8ca6abc` | HDB resale, block + street | Monthly |
| OneMap `/api/common/elastic/search` | HDB block → lat/lng/postcode | On demand (15k/hr) |
| data.gov.sg `d_07c63be0f37e6e59c07a4ddc2fd87fcb` | CEA salesperson registry | Monthly |
| data.gov.sg `d_ee7e46d3c57f7865790704632b0aef71` bulk CSV | CEA salesperson residential transactions | Monthly |
| data.gov.sg "Master Plan 2019 Subzone Boundary (No Sea)" | ~330 planning subzone polygons | One-off (manual GeoJSON download to `data/mp19_subzones.geojson`) |

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
