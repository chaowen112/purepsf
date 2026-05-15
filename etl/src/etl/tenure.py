"""Refresh projects.tenure_type / lease_commence_year from transactions.

Idempotent: should be re-run after any URA / HDB transaction ETL so newly
ingested rows are reflected in project-level tenure summaries.
"""
from __future__ import annotations

import logging

from etl import config
from etl.db import connect

logger = logging.getLogger(__name__)

_HDB_UPDATE = """
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
WHERE p.id = hdb.project_id
  AND (p.tenure_type IS DISTINCT FROM '99-year'
       OR p.lease_commence_year IS DISTINCT FROM hdb.year)
"""

_URA_UPDATE = """
WITH ura_rows AS (
    SELECT
        t.project_id,
        CASE
            WHEN t.tenure ~* '^freehold'      THEN 'Freehold'
            WHEN t.tenure ~* '^999\\s*yrs?'   THEN '999-year'
            WHEN t.tenure ~* '^99\\s*yrs?'    THEN '99-year'
            WHEN t.tenure ~* '^[0-9]+\\s*yrs?' THEN 'Other'
            ELSE 'Other'
        END AS tenure_type,
        (regexp_match(t.tenure, 'from\\s+([0-9]{4})'))[1]::int AS year
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
WHERE p.id = r.project_id AND r.rn = 1
  AND (p.tenure_type IS DISTINCT FROM r.tenure_type
       OR p.lease_commence_year IS DISTINCT FROM r.year)
"""


def run() -> None:
    cfg = config.load()
    with connect(cfg.database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(_HDB_UPDATE)
            hdb = cur.rowcount
            cur.execute(_URA_UPDATE)
            ura = cur.rowcount
        conn.commit()
    logger.info("refresh-tenure: hdb_updated=%d ura_updated=%d", hdb, ura)
