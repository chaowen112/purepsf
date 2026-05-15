-- Trigram indexes for fast ILIKE on the search endpoint.
-- pg_trgm + GIN means '%substring%' becomes index-backed instead of seq-scan.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_projects_name_trgm
    ON projects USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_projects_street_trgm
    ON projects USING gin (street gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_projects_postal_code
    ON projects (postal_code) WHERE postal_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subzones_name_trgm
    ON planning_subzones USING gin (subzone_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_subzones_planning_area_trgm
    ON planning_subzones USING gin (planning_area gin_trgm_ops);
