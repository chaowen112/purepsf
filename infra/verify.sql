-- purePSF data sanity checks.
-- Run: psql "$DATABASE_URL" -f infra/verify.sql
--
-- Hard fails (RAISE EXCEPTION):
--   - any source with 0 projects or 0 transactions
--   - >1% of projects without geom
--   - PSF distribution outside SG-plausible band (50 < median < 5000)
--   - any project with future-dated transactions

\echo === counts by source ===
SELECT p.source::text,
       COUNT(DISTINCT p.id)                                AS projects,
       COUNT(DISTINCT p.id) FILTER (WHERE p.geom IS NULL)  AS projects_no_geom,
       COUNT(t.id)                                         AS transactions,
       MIN(t.contract_date)                                AS earliest,
       MAX(t.contract_date)                                AS latest
FROM projects p
LEFT JOIN transactions t ON t.project_id = p.id
GROUP BY p.source
ORDER BY p.source;

\echo === PSF distribution by source (percentile) ===
SELECT t.source::text,
       COUNT(*)                                                       AS n,
       percentile_cont(0.05) WITHIN GROUP (ORDER BY t.psf)::numeric(10,1) AS p05,
       percentile_cont(0.50) WITHIN GROUP (ORDER BY t.psf)::numeric(10,1) AS p50,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY t.psf)::numeric(10,1) AS p95,
       MAX(t.psf)::numeric(10,1)                                      AS max_psf
FROM transactions t
WHERE t.psf IS NOT NULL
GROUP BY t.source
ORDER BY t.source;

\echo === geocode_cache stats ===
SELECT confidence, COUNT(*) AS n
FROM geocode_cache
GROUP BY confidence
ORDER BY n DESC;

\echo === HDB projects missing postal_code ===
SELECT COUNT(*) AS hdb_no_postal
FROM projects
WHERE source = 'HDB' AND postal_code IS NULL;

\echo === assertions ===
DO $$
DECLARE
    ura_p INT; ura_t INT; hdb_p INT; hdb_t INT;
    no_geom_pct NUMERIC; future_txn INT;
    median_psf NUMERIC;
BEGIN
    SELECT COUNT(*) INTO ura_p FROM projects WHERE source = 'URA';
    SELECT COUNT(*) INTO ura_t FROM transactions WHERE source = 'URA';
    SELECT COUNT(*) INTO hdb_p FROM projects WHERE source = 'HDB';
    SELECT COUNT(*) INTO hdb_t FROM transactions WHERE source = 'HDB';

    IF ura_p = 0 OR ura_t = 0 THEN
        RAISE EXCEPTION 'URA empty: projects=% transactions=%', ura_p, ura_t;
    END IF;
    IF hdb_p = 0 OR hdb_t = 0 THEN
        RAISE EXCEPTION 'HDB empty: projects=% transactions=%', hdb_p, hdb_t;
    END IF;

    SELECT 100.0 * COUNT(*) FILTER (WHERE geom IS NULL) / NULLIF(COUNT(*), 0)
    INTO no_geom_pct FROM projects;
    IF no_geom_pct > 1.0 THEN
        RAISE EXCEPTION 'too many projects missing geom: %.2f%%', no_geom_pct;
    END IF;

    SELECT COUNT(*) INTO future_txn FROM transactions WHERE contract_date > CURRENT_DATE;
    IF future_txn > 0 THEN
        RAISE EXCEPTION 'found % transactions with future contract_date', future_txn;
    END IF;

    SELECT percentile_cont(0.50) WITHIN GROUP (ORDER BY psf)
    INTO median_psf FROM transactions WHERE psf IS NOT NULL;
    IF median_psf < 50 OR median_psf > 5000 THEN
        RAISE EXCEPTION 'median PSF % outside plausible band [50, 5000]', median_psf;
    END IF;

    RAISE NOTICE 'verify OK: URA=%/%, HDB=%/%, median PSF=%, no_geom=%.2f%%',
        ura_p, ura_t, hdb_p, hdb_t, median_psf, no_geom_pct;
END $$;
