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

-- hdb_property_info: official HDB block-level metadata from data.gov.sg.
-- This enriches projects, especially newer blocks without resale transactions.
CREATE TABLE IF NOT EXISTS hdb_property_info (
    project_key                 TEXT PRIMARY KEY,
    blk_no                      TEXT NOT NULL,
    street                      TEXT NOT NULL,
    max_floor_lvl               INT,
    year_completed              INT,
    residential                 BOOLEAN NOT NULL DEFAULT false,
    commercial                  BOOLEAN NOT NULL DEFAULT false,
    market_hawker               BOOLEAN NOT NULL DEFAULT false,
    miscellaneous               BOOLEAN NOT NULL DEFAULT false,
    multistorey_carpark         BOOLEAN NOT NULL DEFAULT false,
    precinct_pavilion           BOOLEAN NOT NULL DEFAULT false,
    bldg_contract_town          TEXT,
    total_dwelling_units        INT NOT NULL DEFAULT 0,
    one_room_sold               INT NOT NULL DEFAULT 0,
    two_room_sold               INT NOT NULL DEFAULT 0,
    three_room_sold             INT NOT NULL DEFAULT 0,
    four_room_sold              INT NOT NULL DEFAULT 0,
    five_room_sold              INT NOT NULL DEFAULT 0,
    exec_sold                   INT NOT NULL DEFAULT 0,
    multigen_sold               INT NOT NULL DEFAULT 0,
    studio_apartment_sold       INT NOT NULL DEFAULT 0,
    one_room_rental             INT NOT NULL DEFAULT 0,
    two_room_rental             INT NOT NULL DEFAULT 0,
    three_room_rental           INT NOT NULL DEFAULT 0,
    other_room_rental           INT NOT NULL DEFAULT 0,
    raw_record                  JSONB NOT NULL,
    fetched_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hdb_property_info_street ON hdb_property_info (street);
CREATE INDEX IF NOT EXISTS idx_hdb_property_info_year_completed ON hdb_property_info (year_completed);
CREATE INDEX IF NOT EXISTS idx_hdb_property_info_residential ON hdb_property_info (residential);

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

-- external_project_links: manually curated outbound links to listing portals.
-- These are link-outs only; purePSF does not ingest third-party listing content.
CREATE TABLE IF NOT EXISTS external_project_links (
    project_id      BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    provider        TEXT NOT NULL,
    url_sale        TEXT,
    url_rent        TEXT,
    url_project     TEXT,
    match_method    TEXT,
    confidence      DOUBLE PRECISION,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_external_project_links_provider
    ON external_project_links (provider);

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

CREATE OR REPLACE FUNCTION hdb_property_info_touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hdb_property_info_updated_at ON hdb_property_info;
CREATE TRIGGER trg_hdb_property_info_updated_at
    BEFORE UPDATE ON hdb_property_info
    FOR EACH ROW EXECUTE FUNCTION hdb_property_info_touch_updated_at();
