-- Verify that the repeatable live feeds have populated recent data.
-- Run through `make verify-data` so a host psql installation is not required.

\echo === transaction coverage ===
SELECT source::text,
       COUNT(*) AS transactions,
       MIN(contract_date) AS earliest,
       MAX(contract_date) AS latest
FROM transactions
GROUP BY source
ORDER BY source;

\echo === supporting datasets ===
SELECT 'HDB property info' AS dataset,
       COUNT(*) AS rows,
       MAX(fetched_at)::date AS latest
FROM hdb_property_info
UNION ALL
SELECT 'CEA salespeople', COUNT(*), MAX(updated_at)::date
FROM salespeople
UNION ALL
SELECT 'CEA transactions', COUNT(*), MAX(transaction_date)
FROM salesperson_transactions
ORDER BY dataset;

\echo === map coverage ===
SELECT source::text,
       COUNT(*) AS projects,
       COUNT(*) FILTER (WHERE geom IS NULL) AS missing_geom,
       ROUND(
           100.0 * COUNT(*) FILTER (WHERE geom IS NULL) / NULLIF(COUNT(*), 0),
           2
       ) AS missing_geom_pct
FROM projects
GROUP BY source
ORDER BY source;

\echo === freshness assertions ===
DO $$
DECLARE
    cutoff DATE := (date_trunc('month', CURRENT_DATE) - INTERVAL '2 months')::date;
    ura_latest DATE;
    hdb_latest DATE;
    cea_latest DATE;
    hdb_info_latest DATE;
    cea_rows BIGINT;
BEGIN
    SELECT MAX(contract_date) INTO ura_latest
    FROM transactions WHERE source = 'URA';
    SELECT MAX(contract_date) INTO hdb_latest
    FROM transactions WHERE source = 'HDB';
    SELECT MAX(transaction_date), COUNT(*) INTO cea_latest, cea_rows
    FROM salesperson_transactions;
    SELECT MAX(fetched_at)::date INTO hdb_info_latest
    FROM hdb_property_info;

    IF ura_latest IS NULL OR ura_latest < cutoff THEN
        RAISE EXCEPTION 'URA data stale: latest=%, cutoff=%', ura_latest, cutoff;
    END IF;
    IF hdb_latest IS NULL OR hdb_latest < cutoff THEN
        RAISE EXCEPTION 'HDB resale data stale: latest=%, cutoff=%', hdb_latest, cutoff;
    END IF;
    IF cea_latest IS NULL OR cea_latest < cutoff OR cea_rows < 1000000 THEN
        RAISE EXCEPTION 'CEA transactions incomplete/stale: rows=%, latest=%, cutoff=%',
            cea_rows, cea_latest, cutoff;
    END IF;
    IF hdb_info_latest IS NULL OR hdb_info_latest < CURRENT_DATE - 45 THEN
        RAISE EXCEPTION 'HDB property info stale: fetched=%', hdb_info_latest;
    END IF;

    RAISE NOTICE 'freshness OK: URA=%, HDB=%, CEA=% (rows=%), HDB info=%',
        ura_latest, hdb_latest, cea_latest, cea_rows, hdb_info_latest;
END $$;
