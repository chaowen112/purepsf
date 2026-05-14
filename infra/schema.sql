-- purePSF schema (Postgres 16 + PostGIS 3)
-- Idempotent: safe to run multiple times.

CREATE EXTENSION IF NOT EXISTS postgis;

-- 1 sqm = SQFT_PER_SQM sqft. Defined here so PSF computation is consistent across ETL and DB.
-- PostGIS / Postgres has no global constants; keep the literal 10.7639 in the GENERATED column below
-- and reference this comment when changing it.

-- Sources
DO $$ BEGIN
    CREATE TYPE source_kind AS ENUM ('URA', 'HDB');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- projects: physical site, deduped from URA / HDB
CREATE TABLE IF NOT EXISTS projects (
    id              BIGSERIAL PRIMARY KEY,
    source          source_kind NOT NULL,
    project_key     TEXT NOT NULL,            -- URA: project name; HDB: BLOCK + '|' + STREET (normalized upper)
    name            TEXT NOT NULL,
    street          TEXT,
    postal_code     TEXT,                     -- HDB after geocode, URA where available
    district        TEXT,                     -- e.g. "D09"
    market_segment  TEXT,                     -- CCR / RCR / OCR (URA only)
    property_type   TEXT,                     -- coarse: Condo / Apartment / Landed / HDB
    lat             DOUBLE PRECISION,
    lng             DOUBLE PRECISION,
    geom            geometry(Point, 4326),
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source, project_key)
);

CREATE INDEX IF NOT EXISTS idx_projects_geom ON projects USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_projects_district ON projects (district);
CREATE INDEX IF NOT EXISTS idx_projects_source ON projects (source);

-- transactions: one row per recorded sale
CREATE TABLE IF NOT EXISTS transactions (
    id                  BIGSERIAL PRIMARY KEY,
    project_id          BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source              source_kind NOT NULL,
    contract_date       DATE NOT NULL,
    area_sqm            NUMERIC(10,2),
    price               NUMERIC(14,2) NOT NULL,
    psf                 NUMERIC(10,2) GENERATED ALWAYS AS (
                            CASE WHEN area_sqm > 0
                                 THEN price / (area_sqm * 10.7639)
                                 ELSE NULL END
                        ) STORED,
    tenure              TEXT,
    floor_range         TEXT,
    property_type       TEXT,
    type_of_sale        TEXT,    -- 'New Sale' | 'Resale' | 'Sub Sale' (URA); 'Resale' (HDB)
    -- HDB-only:
    flat_type           TEXT,
    lease_commence_year INT,
    -- URA-only:
    no_of_units         INT,
    -- Stable dedup key for idempotent ETL upsert
    dedup_key           TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_transactions_project ON transactions (project_id);
CREATE INDEX IF NOT EXISTS idx_transactions_contract_date ON transactions (contract_date);
CREATE INDEX IF NOT EXISTS idx_transactions_source_date ON transactions (source, contract_date);

-- developer_sales_snapshots: URA monthly developer sales per project
CREATE TABLE IF NOT EXISTS developer_sales_snapshots (
    id                          BIGSERIAL PRIMARY KEY,
    project_id                  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    snapshot_month              DATE NOT NULL,            -- first day of month
    units_total                 INT,
    units_launched_cumulative   INT,
    units_sold_cumulative       INT,
    units_unsold                INT,
    UNIQUE (project_id, snapshot_month)
);

CREATE INDEX IF NOT EXISTS idx_dev_sales_project ON developer_sales_snapshots (project_id);
CREATE INDEX IF NOT EXISTS idx_dev_sales_month ON developer_sales_snapshots (snapshot_month);

-- tracked_projects: the 10 MVP picks (and beyond)
CREATE TABLE IF NOT EXISTS tracked_projects (
    project_id      BIGINT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    notes           TEXT,
    added_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- geocode_cache: avoid hammering OneMap on re-runs
CREATE TABLE IF NOT EXISTS geocode_cache (
    query_string    TEXT PRIMARY KEY,         -- normalized: BLOCK|STREET (HDB) or full address
    lat             DOUBLE PRECISION,
    lng             DOUBLE PRECISION,
    onemap_response JSONB,
    source          TEXT NOT NULL,            -- 'onemap' | 'manual'
    confidence      TEXT NOT NULL,            -- 'high' | 'low' | 'failed'
    geocoded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_geocode_cache_confidence ON geocode_cache (confidence);

-- Trigger to keep projects.updated_at fresh and projects.geom in sync with lat/lng
CREATE OR REPLACE FUNCTION projects_sync_geom() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
        NEW.geom := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326);
    ELSE
        NEW.geom := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_projects_sync_geom ON projects;
CREATE TRIGGER trg_projects_sync_geom
    BEFORE INSERT OR UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION projects_sync_geom();
