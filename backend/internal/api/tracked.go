package api

import "net/http"

type trackedProject struct {
	ID               int64    `json:"id"`
	Source           string   `json:"source"`
	Name             string   `json:"name"`
	Street           *string  `json:"street,omitempty"`
	District         *string  `json:"district,omitempty"`
	MarketSegment    *string  `json:"market_segment,omitempty"`
	PropertyType     *string  `json:"property_type,omitempty"`
	Lat              *float64 `json:"lat,omitempty"`
	Lng              *float64 `json:"lng,omitempty"`
	Notes            *string  `json:"notes,omitempty"`
	TransactionCount int64    `json:"transaction_count"`
	AvgPSF           *float64 `json:"avg_psf,omitempty"`
	LatestDate       *string  `json:"latest_transaction,omitempty"`
}

func (s *Server) handleTracked(w http.ResponseWriter, r *http.Request) {
	const q = `
		SELECT p.id, p.source::text, p.name, p.street, p.district, p.market_segment,
		       p.property_type, p.lat, p.lng,
		       tp.notes,
		       COUNT(t.id)                           AS transaction_count,
		       ROUND(AVG(t.psf)::numeric, 0)::float8  AS avg_psf,
		       MAX(t.contract_date)::text             AS latest_transaction
		FROM tracked_projects tp
		JOIN projects p ON p.id = tp.project_id
		LEFT JOIN transactions t ON t.project_id = p.id
		GROUP BY p.id, tp.notes, tp.added_at
		ORDER BY tp.added_at`

	rows, err := s.pool.Query(r.Context(), q)
	if err != nil {
		s.logger.Error("handleTracked", "err", err)
		writeError(w, http.StatusInternalServerError, "query error")
		return
	}
	defer rows.Close()

	result := make([]trackedProject, 0)
	for rows.Next() {
		var p trackedProject
		if err := rows.Scan(
			&p.ID, &p.Source, &p.Name, &p.Street, &p.District,
			&p.MarketSegment, &p.PropertyType, &p.Lat, &p.Lng,
			&p.Notes,
			&p.TransactionCount, &p.AvgPSF, &p.LatestDate,
		); err != nil {
			s.logger.Error("handleTracked scan", "err", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		result = append(result, p)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "rows error")
		return
	}
	writeJSON(w, http.StatusOK, result)
}
