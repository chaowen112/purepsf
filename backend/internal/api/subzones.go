package api

import (
	"encoding/json"
	"net/http"
)

// handleSubzoneStats returns a GeoJSON FeatureCollection of all planning
// subzones with aggregated PSF stats (both URA and HDB) from the
// transactions table. Designed for MapLibre to consume directly as a
// fill layer.
//
// Query params (optional):
//
//	from=YYYY-MM-DD
//	to=YYYY-MM-DD
func (s *Server) handleSubzoneStats(w http.ResponseWriter, r *http.Request) {
	from := nullStr(r.URL.Query().Get("from"))
	to := nullStr(r.URL.Query().Get("to"))

	const q = `
		WITH agg AS (
			SELECT z.id,
			       ROUND(AVG(t.psf)::numeric, 0)::float8 AS avg_psf,
			       COUNT(t.id)                           AS count
			FROM planning_subzones z
			LEFT JOIN projects p
			       ON p.geom IS NOT NULL
			      AND ST_Contains(z.geom, p.geom)
			LEFT JOIN transactions t
			       ON t.project_id = p.id
			      AND ($1::date IS NULL OR t.contract_date >= $1::date)
			      AND ($2::date IS NULL OR t.contract_date <= $2::date)
			      AND t.psf IS NOT NULL
			GROUP BY z.id
		)
		SELECT z.id, z.subzone_name, z.planning_area, z.region,
		       agg.avg_psf, agg.count,
		       ST_AsGeoJSON(z.geom, 6)::text AS geom
		FROM planning_subzones z
		JOIN agg ON agg.id = z.id
		ORDER BY z.id`

	rows, err := s.pool.Query(r.Context(), q, from, to)
	if err != nil {
		s.logger.Error("handleSubzoneStats", "err", err)
		writeError(w, http.StatusInternalServerError, "query error")
		return
	}
	defer rows.Close()

	type feature struct {
		Type       string          `json:"type"`
		Geometry   json.RawMessage `json:"geometry"`
		Properties map[string]any  `json:"properties"`
	}
	features := make([]feature, 0, 350)
	for rows.Next() {
		var id int64
		var name string
		var area, region *string
		var avgPSF *float64
		var count int64
		var geomJSON string
		if err := rows.Scan(&id, &name, &area, &region, &avgPSF, &count, &geomJSON); err != nil {
			s.logger.Error("handleSubzoneStats scan", "err", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		features = append(features, feature{
			Type:     "Feature",
			Geometry: json.RawMessage(geomJSON),
			Properties: map[string]any{
				"id":            id,
				"subzone_name":  name,
				"planning_area": derefStr(area),
				"region":        derefStr(region),
				"avg_psf":       avgPSF,
				"count":         count,
			},
		})
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "rows error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"type":     "FeatureCollection",
		"features": features,
	})
}

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
