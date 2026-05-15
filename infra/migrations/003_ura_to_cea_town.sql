-- URA planning_area → CEA town(s) translation.
-- CEA collapses 8 central URA areas into "CENTRAL AREA", and has two
-- name divergences (KALLANG→"KALLANG/WHAMPOA", QUEENSTOWN→"QUEESTOWN"
-- which appears to be a CEA-side typo). Returns a SQL array so the
-- caller can filter via WHERE town = ANY(...).

CREATE OR REPLACE FUNCTION ura_planning_area_to_cea_towns(area TEXT)
RETURNS TEXT[] AS $$
    SELECT CASE upper(area)
        WHEN 'DOWNTOWN CORE'   THEN ARRAY['CENTRAL AREA']
        WHEN 'MUSEUM'          THEN ARRAY['CENTRAL AREA']
        WHEN 'NEWTON'          THEN ARRAY['CENTRAL AREA']
        WHEN 'ORCHARD'         THEN ARRAY['CENTRAL AREA']
        WHEN 'OUTRAM'          THEN ARRAY['CENTRAL AREA']
        WHEN 'RIVER VALLEY'    THEN ARRAY['CENTRAL AREA']
        WHEN 'ROCHOR'          THEN ARRAY['CENTRAL AREA']
        WHEN 'SINGAPORE RIVER' THEN ARRAY['CENTRAL AREA']
        WHEN 'KALLANG'         THEN ARRAY['KALLANG/WHAMPOA']
        WHEN 'QUEENSTOWN'      THEN ARRAY['QUEESTOWN']
        ELSE                        ARRAY[upper(area)]
    END;
$$ LANGUAGE SQL IMMUTABLE;
