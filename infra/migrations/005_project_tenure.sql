-- Denormalize tenure / lease commencement onto projects so it's a single
-- read instead of a per-transaction aggregate at query time. Idempotent.
--
-- HDB:  always 99-year, lease_commence_year from transactions (100% coverage)
-- URA:  parse the standard "99 yrs lease commencing from YYYY" / "Freehold"
--       / "999 yrs lease commencing from YYYY" strings on transactions.
--       For projects with mixed tenures (rare: phased developments), pick
--       the most-common label per project.

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS tenure_type         TEXT,
    ADD COLUMN IF NOT EXISTS lease_commence_year INT;

CREATE INDEX IF NOT EXISTS idx_projects_tenure_type ON projects (tenure_type);

-- HDB: max lease year wins for blocks that may have been re-leased.
WITH hdb AS (
    SELECT project_id, MAX(lease_commence_year) AS year
    FROM transactions
    WHERE source = 'HDB' AND lease_commence_year IS NOT NULL
    GROUP BY project_id
)
UPDATE projects p
SET tenure_type = '99-year',
    lease_commence_year = hdb.year
FROM hdb
WHERE p.id = hdb.project_id;

-- URA: classify each tenure string, then pick the most-common per project.
WITH ura_rows AS (
    SELECT
        t.project_id,
        CASE
            WHEN t.tenure ~* '^freehold'           THEN 'Freehold'
            WHEN t.tenure ~* '^999\s*yrs?'         THEN '999-year'
            WHEN t.tenure ~* '^99\s*yrs?'          THEN '99-year'
            WHEN t.tenure ~* '^[0-9]+\s*yrs?'      THEN 'Other'
            ELSE 'Other'
        END AS tenure_type,
        (regexp_match(t.tenure, 'from\s+([0-9]{4})'))[1]::int AS year
    FROM transactions t
    WHERE t.source = 'URA' AND t.tenure IS NOT NULL
),
counts AS (
    SELECT project_id, tenure_type, year, COUNT(*) AS n
    FROM ura_rows
    GROUP BY project_id, tenure_type, year
),
ranked AS (
    SELECT project_id, tenure_type, year,
           ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY n DESC, tenure_type) AS rn
    FROM counts
)
UPDATE projects p
SET tenure_type = r.tenure_type,
    lease_commence_year = r.year
FROM ranked r
WHERE p.id = r.project_id AND r.rn = 1;
