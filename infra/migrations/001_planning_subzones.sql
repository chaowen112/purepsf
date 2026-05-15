-- Singapore URA Master Plan 2019 planning subzones (≈ 330 polygons).
-- Loaded by `purepsf-etl planning-subzones --file <geojson>`.
-- Idempotent: safe to re-apply.

CREATE TABLE IF NOT EXISTS planning_subzones (
    id              BIGSERIAL PRIMARY KEY,
    subzone_code    TEXT,                      -- e.g. "BSSZ01" if present
    subzone_name    TEXT NOT NULL,
    planning_area   TEXT,                      -- e.g. "BISHAN"
    region          TEXT,                      -- e.g. "CENTRAL REGION"
    geom            geometry(MultiPolygon, 4326) NOT NULL,
    loaded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (subzone_name, planning_area)
);

CREATE INDEX IF NOT EXISTS idx_subzones_geom ON planning_subzones USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_subzones_area ON planning_subzones (planning_area);
