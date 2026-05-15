package api

import (
	"net/http"
	"strings"
)

// handleSearch returns mixed project + subzone hits matching the query.
//
//	GET /api/search?q=<term>&limit=20
//
// Match priority (highest first):
//  1. postal_code exact (6-digit numeric input)
//  2. project name / street / subzone name starts-with
//  3. anything else containing the term
type searchHit struct {
	Type      string   `json:"type"`             // "project" | "subzone"
	ID        int64    `json:"id"`
	Label     string   `json:"label"`
	Secondary string   `json:"secondary"`
	Lat       *float64 `json:"lat,omitempty"`
	Lng       *float64 `json:"lng,omitempty"`
	Source    *string  `json:"source,omitempty"` // URA | HDB for projects
}

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeJSON(w, http.StatusOK, []searchHit{})
		return
	}
	limit := parseInt(r.URL.Query().Get("limit"), 20, 1, 50)
	// Split the budget — subzones are usually a handful of strong hits, so cap
	// them at limit/4 (≥3) and give the rest to projects.
	subzoneBudget := limit / 4
	if subzoneBudget < 3 {
		subzoneBudget = 3
	}
	projectBudget := limit - subzoneBudget

	qUpper := strings.ToUpper(q)
	qLike := "%" + qUpper + "%"
	qPrefix := qUpper + "%"

	// 1) Project hits. Score: postal exact > name/street prefix > contains.
	const projectsQ = `
		SELECT p.id, p.name, p.street, p.postal_code, p.lat, p.lng, p.source::text,
		       CASE
		           WHEN p.postal_code = $1                                 THEN 100
		           WHEN upper(p.name)   LIKE $3                            THEN 50
		           WHEN upper(p.street) LIKE $3                            THEN 40
		           WHEN upper(p.name)   LIKE $2                            THEN 20
		           WHEN upper(p.street) LIKE $2                            THEN 15
		           ELSE 0
		       END AS score
		FROM projects p
		WHERE p.lat IS NOT NULL
		  AND (p.postal_code = $1
		       OR upper(p.name)   LIKE $2
		       OR upper(p.street) LIKE $2)
		ORDER BY score DESC,
		         (SELECT COUNT(*) FROM transactions t WHERE t.project_id = p.id) DESC
		LIMIT $4`

	rows, err := s.pool.Query(r.Context(), projectsQ, qUpper, qLike, qPrefix, projectBudget)
	if err != nil {
		s.logger.Error("search projects", "err", err)
		writeError(w, http.StatusInternalServerError, "query error")
		return
	}
	// Subzones come back from the second query and we prepend them so area
	// hits appear first — users typing "BISHAN" usually want the area jump.
	projectHits := make([]searchHit, 0, projectBudget)
	for rows.Next() {
		var id int64
		var name string
		var street, postal *string
		var lat, lng *float64
		var source string
		var score int
		if err := rows.Scan(&id, &name, &street, &postal, &lat, &lng, &source, &score); err != nil {
			rows.Close()
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		bits := []string{source}
		if postal != nil {
			bits = append(bits, "S("+*postal+")")
		}
		if street != nil && (source == "URA" || !strings.Contains(name, *street)) {
			bits = append(bits, *street)
		}
		src := source
		projectHits = append(projectHits, searchHit{
			Type: "project", ID: id, Label: name,
			Secondary: strings.Join(bits, " · "),
			Lat: lat, Lng: lng, Source: &src,
		})
	}
	rows.Close()

	subzoneHits := make([]searchHit, 0, subzoneBudget)

	// 2) Subzone hits.
	const subzonesQ = `
		SELECT z.id, z.subzone_name, z.planning_area, z.region,
		       ST_Y(ST_Centroid(z.geom))::float8 AS lat,
		       ST_X(ST_Centroid(z.geom))::float8 AS lng,
		       CASE
		           WHEN upper(z.subzone_name)  LIKE $2 THEN 50
		           WHEN upper(z.planning_area) LIKE $2 THEN 40
		           WHEN upper(z.region)        LIKE $2 THEN 25
		           WHEN upper(z.subzone_name)  LIKE $1 THEN 20
		           WHEN upper(z.planning_area) LIKE $1 THEN 15
		           ELSE 0
		       END AS score
		FROM planning_subzones z
		WHERE upper(z.subzone_name)  LIKE $1
		   OR upper(z.planning_area) LIKE $1
		   OR upper(z.region)        LIKE $1
		ORDER BY score DESC, z.subzone_name
		LIMIT $3`

	rows2, err := s.pool.Query(r.Context(), subzonesQ, qLike, qPrefix, subzoneBudget)
	if err != nil {
		s.logger.Error("search subzones", "err", err)
		writeError(w, http.StatusInternalServerError, "query error")
		return
	}
	defer rows2.Close()
	for rows2.Next() {
		var id int64
		var name string
		var area, region *string
		var lat, lng *float64
		var score int
		if err := rows2.Scan(&id, &name, &area, &region, &lat, &lng, &score); err != nil {
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		bits := []string{}
		if area != nil && *area != "" {
			bits = append(bits, *area)
		}
		if region != nil && *region != "" {
			bits = append(bits, *region)
		}
		subzoneHits = append(subzoneHits, searchHit{
			Type: "subzone", ID: id, Label: name,
			Secondary: strings.Join(bits, " · "),
			Lat: lat, Lng: lng,
		})
	}

	// Subzones first (they're usually the user's intended area-jump), then
	// projects. Budgets above already prevent overflow.
	hits := append(subzoneHits, projectHits...)
	writeJSON(w, http.StatusOK, hits)
}
