-- Seed the 10 MVP tracked projects.
-- Run AFTER URA transactions have been loaded so the projects already exist.
-- Project names must match URA's PMI_Resi_Transaction `project` field exactly.

-- Replace the names below with current new-launch picks before running.
-- Example shape; fill in real names when ETL is in place.
INSERT INTO tracked_projects (project_id, notes)
SELECT id, 'MVP seed'
FROM projects
WHERE source = 'URA'
  AND project_key IN (
      -- 'NORWOOD GRAND',
      -- 'CHUAN PARK',
      -- 'EMERALD OF KATONG',
      -- 'THE ORIE',
      -- 'PARKTOWN RESIDENCE',
      -- ... fill in
      ''
  )
ON CONFLICT (project_id) DO NOTHING;
