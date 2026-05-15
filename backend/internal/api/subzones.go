package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
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

// ---- /api/subzones/{id} ----

type subzoneSummary struct {
	ID            int64    `json:"id"`
	Name          string   `json:"subzone_name"`
	PlanningArea  *string  `json:"planning_area,omitempty"`
	Region        *string  `json:"region,omitempty"`
	AvgPSF        *float64 `json:"avg_psf,omitempty"`
	TxnCount      int64    `json:"transaction_count"`
	DateFrom      *string  `json:"date_from,omitempty"`
	DateTo        *string  `json:"date_to,omitempty"`
	CEATown       *string  `json:"cea_town,omitempty"` // matched town for agent lookup
}

func (s *Server) handleSubzoneSummary(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	const q = `
		SELECT z.id, z.subzone_name, z.planning_area, z.region,
		       ROUND(AVG(t.psf)::numeric, 0)::float8  AS avg_psf,
		       COUNT(t.id)                            AS txn_count,
		       MIN(t.contract_date)::text             AS date_from,
		       MAX(t.contract_date)::text             AS date_to
		FROM planning_subzones z
		LEFT JOIN projects p
		       ON p.geom IS NOT NULL AND ST_Contains(z.geom, p.geom)
		LEFT JOIN transactions t
		       ON t.project_id = p.id AND t.psf IS NOT NULL
		WHERE z.id = $1
		GROUP BY z.id`

	var sum subzoneSummary
	if err := s.pool.QueryRow(r.Context(), q, id).Scan(
		&sum.ID, &sum.Name, &sum.PlanningArea, &sum.Region,
		&sum.AvgPSF, &sum.TxnCount, &sum.DateFrom, &sum.DateTo,
	); err != nil {
		// pgx returns ErrNoRows as a string-comparable error; just treat any
		// failure-to-scan as not-found since the subzone table is read-only.
		writeError(w, http.StatusNotFound, "subzone not found")
		return
	}
	if sum.PlanningArea != nil {
		cea := uraPlanningAreaToCEATown(*sum.PlanningArea)
		sum.CEATown = &cea
	}
	writeJSON(w, http.StatusOK, sum)
}

// ---- /api/subzones/{id}/transactions ----

func (s *Server) handleSubzoneTransactions(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	limit := parseInt(r.URL.Query().Get("limit"), 100, 1, 1000)
	offset := parseInt(r.URL.Query().Get("offset"), 0, 0, 1_000_000)

	const q = `
		SELECT t.id, t.contract_date::text, t.area_sqm::float8, t.price::float8, t.psf::float8,
		       t.floor_range, t.property_type, t.type_of_sale, t.flat_type, t.no_of_units,
		       p.name AS project_name, p.source::text AS source,
		       CASE
		           WHEN p.tenure_type = '99-year'  AND p.lease_commence_year IS NOT NULL
		               THEN GREATEST(0, 99  - (EXTRACT(year FROM t.contract_date)::int - p.lease_commence_year))::int
		           WHEN p.tenure_type = '999-year' AND p.lease_commence_year IS NOT NULL
		               THEN GREATEST(0, 999 - (EXTRACT(year FROM t.contract_date)::int - p.lease_commence_year))::int
		           ELSE NULL
		       END AS remaining_lease_at_txn
		FROM transactions t
		JOIN projects p ON p.id = t.project_id
		JOIN planning_subzones z ON z.id = $1
		WHERE p.geom IS NOT NULL
		  AND ST_Contains(z.geom, p.geom)
		ORDER BY t.contract_date DESC, t.id DESC
		LIMIT $2 OFFSET $3`

	rows, err := s.pool.Query(r.Context(), q, id, limit, offset)
	if err != nil {
		s.logger.Error("handleSubzoneTransactions", "err", err)
		writeError(w, http.StatusInternalServerError, "query error")
		return
	}
	defer rows.Close()

	type row struct {
		ID                  int64    `json:"id"`
		ContractDate        string   `json:"contract_date"`
		AreaSqm             *float64 `json:"area_sqm,omitempty"`
		Price               float64  `json:"price"`
		PSF                 *float64 `json:"psf,omitempty"`
		FloorRange          *string  `json:"floor_range,omitempty"`
		PropertyType        *string  `json:"property_type,omitempty"`
		TypeOfSale          *string  `json:"type_of_sale,omitempty"`
		FlatType            *string  `json:"flat_type,omitempty"`
		NoOfUnits           *int32   `json:"no_of_units,omitempty"`
		ProjectName         string   `json:"project_name"`
		Source              string   `json:"source"`
		RemainingLeaseAtTxn *int32   `json:"remaining_lease_at_txn,omitempty"`
	}
	out := make([]row, 0, limit)
	for rows.Next() {
		var t row
		if err := rows.Scan(
			&t.ID, &t.ContractDate, &t.AreaSqm, &t.Price, &t.PSF,
			&t.FloorRange, &t.PropertyType, &t.TypeOfSale, &t.FlatType, &t.NoOfUnits,
			&t.ProjectName, &t.Source, &t.RemainingLeaseAtTxn,
		); err != nil {
			s.logger.Error("handleSubzoneTransactions scan", "err", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, t)
	}
	writeJSON(w, http.StatusOK, out)
}

// ---- /api/subzones/{id}/psf-timeseries ----

func (s *Server) handleSubzoneTimeseries(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	const q = `
		SELECT date_trunc('month', t.contract_date)::date::text AS month,
		       ROUND(AVG(t.psf)::numeric, 0)::float8             AS avg_psf,
		       COUNT(*)                                           AS count
		FROM transactions t
		JOIN projects p ON p.id = t.project_id
		JOIN planning_subzones z ON z.id = $1
		WHERE p.geom IS NOT NULL
		  AND ST_Contains(z.geom, p.geom)
		  AND t.psf IS NOT NULL
		GROUP BY 1
		ORDER BY 1`

	rows, err := s.pool.Query(r.Context(), q, id)
	if err != nil {
		s.logger.Error("handleSubzoneTimeseries", "err", err)
		writeError(w, http.StatusInternalServerError, "query error")
		return
	}
	defer rows.Close()

	type bucket struct {
		Month  string  `json:"month"`
		AvgPSF float64 `json:"avg_psf"`
		Count  int64   `json:"count"`
	}
	out := make([]bucket, 0, 120)
	for rows.Next() {
		var b bucket
		if err := rows.Scan(&b.Month, &b.AvgPSF, &b.Count); err != nil {
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, b)
	}
	writeJSON(w, http.StatusOK, out)
}

// ---- /api/subzones/{id}/agents ----

type agentRow struct {
	Name             string  `json:"name"`
	RegistrationNo   string  `json:"registration_no"`
	EstateAgent      *string `json:"estate_agent,omitempty"`
	TotalTxns        int64   `json:"total_txns"`
	HDBPct           float64 `json:"hdb_pct"`
	CondoPct         float64 `json:"condo_pct"`
	SellerPct        float64 `json:"seller_pct"`
	BuyerPct         float64 `json:"buyer_pct"`
}

func (s *Server) handleSubzoneAgents(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	limit := parseInt(r.URL.Query().Get("limit"), 20, 1, 200)
	from := nullStr(r.URL.Query().Get("from"))
	to := nullStr(r.URL.Query().Get("to"))
	propertyType := nullStr(strings.ToUpper(r.URL.Query().Get("property_type")))
	represented := nullStr(strings.ToUpper(r.URL.Query().Get("represented")))

	// CEA data is town-level (planning area). Look up the subzone's planning
	// area and translate to the CEA spelling, then aggregate.
	const q = `
		WITH zone AS (
			SELECT planning_area FROM planning_subzones WHERE id = $1
		),
		cea_towns AS (
			SELECT unnest(ura_planning_area_to_cea_towns((SELECT planning_area FROM zone))) AS town
		),
		txns AS (
			SELECT *
			FROM salesperson_transactions
			WHERE town IN (SELECT town FROM cea_towns)
			  AND ($2::date IS NULL OR transaction_date >= $2::date)
			  AND ($3::date IS NULL OR transaction_date <= $3::date)
			  AND ($4::text IS NULL OR property_type = $4)
			  AND ($5::text IS NULL OR represented = $5)
		)
		SELECT
		    COALESCE(sp.salesperson_name, t.salesperson_name) AS name,
		    t.salesperson_reg_num,
		    sp.estate_agent_name,
		    COUNT(*)                                                                       AS total_txns,
		    100.0 * COUNT(*) FILTER (WHERE t.property_type = 'HDB')         / COUNT(*)     AS hdb_pct,
		    100.0 * COUNT(*) FILTER (WHERE t.property_type = 'CONDOMINIUM') / COUNT(*)     AS condo_pct,
		    100.0 * COUNT(*) FILTER (WHERE t.represented   = 'SELLER')      / COUNT(*)     AS seller_pct,
		    100.0 * COUNT(*) FILTER (WHERE t.represented   = 'BUYER')       / COUNT(*)     AS buyer_pct
		FROM txns t
		LEFT JOIN salespeople sp ON sp.registration_no = t.salesperson_reg_num
		GROUP BY t.salesperson_reg_num, sp.salesperson_name, t.salesperson_name, sp.estate_agent_name
		ORDER BY total_txns DESC
		LIMIT $6`

	rows, err := s.pool.Query(r.Context(), q, id, from, to, propertyType, represented, limit)
	if err != nil {
		s.logger.Error("handleSubzoneAgents", "err", err)
		writeError(w, http.StatusInternalServerError, "query error")
		return
	}
	defer rows.Close()

	out := make([]agentRow, 0, limit)
	for rows.Next() {
		var a agentRow
		if err := rows.Scan(&a.Name, &a.RegistrationNo, &a.EstateAgent,
			&a.TotalTxns, &a.HDBPct, &a.CondoPct, &a.SellerPct, &a.BuyerPct); err != nil {
			s.logger.Error("handleSubzoneAgents scan", "err", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, a)
	}
	writeJSON(w, http.StatusOK, out)
}

// uraPlanningAreaToCEATown returns the CEA-side spelling of a URA planning
// area. CEA collapses central planning areas to "CENTRAL AREA" so this map
// is many-to-one — used only for the response hint; queries use the SQL
// helper ura_planning_area_to_cea_towns(text) which returns an array so the
// CEA→URA many-to-many mismatch resolves cleanly at the query layer.
func uraPlanningAreaToCEATown(area string) string {
	switch strings.ToUpper(area) {
	case "DOWNTOWN CORE", "MUSEUM", "NEWTON", "ORCHARD", "OUTRAM",
		"RIVER VALLEY", "ROCHOR", "SINGAPORE RIVER":
		return "CENTRAL AREA"
	case "KALLANG":
		return "KALLANG/WHAMPOA"
	case "QUEENSTOWN":
		return "QUEESTOWN" // CEA dataset typo, kept as-is in source data
	}
	return strings.ToUpper(area)
}

func parseInt(s string, dflt, lo, hi int) int {
	if s == "" {
		return dflt
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return dflt
	}
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
