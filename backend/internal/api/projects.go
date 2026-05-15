package api

import (
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
)

type projectSummary struct {
	ID                  int64    `json:"id"`
	Source              string   `json:"source"`
	Name                string   `json:"name"`
	Street              *string  `json:"street,omitempty"`
	PostalCode          *string  `json:"postal_code,omitempty"`
	District            *string  `json:"district,omitempty"`
	MarketSegment       *string  `json:"market_segment,omitempty"`
	PropertyType        *string  `json:"property_type,omitempty"`
	Lat                 *float64 `json:"lat,omitempty"`
	Lng                 *float64 `json:"lng,omitempty"`
	TransactionCount    int64    `json:"transaction_count"`
	AvgPSF              *float64 `json:"avg_psf,omitempty"`
	LatestDate          *string  `json:"latest_transaction,omitempty"`
	TenureType          *string  `json:"tenure_type,omitempty"`
	LeaseCommenceYear   *int32   `json:"lease_commence_year,omitempty"`
	RemainingLeaseYears *int32   `json:"remaining_lease_years,omitempty"`
}

// projectFields is the column list (without GROUP BY/aggregates) used by
// list, get-by-id, and subzone queries that return projectSummary shapes.
const remainingLeaseSQL = `
    CASE
        WHEN p.tenure_type = '99-year'  AND p.lease_commence_year IS NOT NULL
            THEN GREATEST(0, 99  - (EXTRACT(year FROM CURRENT_DATE)::int - p.lease_commence_year))::int
        WHEN p.tenure_type = '999-year' AND p.lease_commence_year IS NOT NULL
            THEN GREATEST(0, 999 - (EXTRACT(year FROM CURRENT_DATE)::int - p.lease_commence_year))::int
        ELSE NULL
    END`

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request) {
	bbox := r.URL.Query().Get("bbox")
	if bbox == "" {
		writeError(w, http.StatusBadRequest, "bbox required: lng1,lat1,lng2,lat2")
		return
	}
	parts := strings.Split(bbox, ",")
	if len(parts) != 4 {
		writeError(w, http.StatusBadRequest, "bbox must have 4 comma-separated values")
		return
	}
	coords := make([]float64, 4)
	for i, p := range parts {
		v, err := strconv.ParseFloat(strings.TrimSpace(p), 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid bbox coordinate: "+p)
			return
		}
		coords[i] = v
	}
	lng1, lat1, lng2, lat2 := coords[0], coords[1], coords[2], coords[3]

	q := `
		SELECT p.id, p.source::text, p.name, p.street, p.postal_code, p.district, p.market_segment,
		       p.property_type, p.lat, p.lng,
		       COUNT(t.id)                                    AS transaction_count,
		       ROUND(AVG(t.psf)::numeric, 0)::float8          AS avg_psf,
		       MAX(t.contract_date)::text                     AS latest_transaction,
		       p.tenure_type, p.lease_commence_year,
		       ` + remainingLeaseSQL + ` AS remaining_lease_years
		FROM projects p
		LEFT JOIN transactions t ON t.project_id = p.id
		WHERE p.geom IS NOT NULL
		  AND p.geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
		GROUP BY p.id
		ORDER BY transaction_count DESC
		LIMIT 500`

	rows, err := s.pool.Query(r.Context(), q, lng1, lat1, lng2, lat2)
	if err != nil {
		s.logger.Error("handleListProjects", "err", err)
		writeError(w, http.StatusInternalServerError, "query error")
		return
	}
	defer rows.Close()

	result := make([]projectSummary, 0, 64)
	for rows.Next() {
		var p projectSummary
		if err := rows.Scan(
			&p.ID, &p.Source, &p.Name, &p.Street, &p.PostalCode, &p.District,
			&p.MarketSegment, &p.PropertyType, &p.Lat, &p.Lng,
			&p.TransactionCount, &p.AvgPSF, &p.LatestDate,
			&p.TenureType, &p.LeaseCommenceYear, &p.RemainingLeaseYears,
		); err != nil {
			s.logger.Error("handleListProjects scan", "err", err)
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

// ---- /api/projects/{id} (single) ----

func (s *Server) handleGetProject(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	q := `
		SELECT p.id, p.source::text, p.name, p.street, p.postal_code, p.district, p.market_segment,
		       p.property_type, p.lat, p.lng,
		       COUNT(t.id)                            AS transaction_count,
		       ROUND(AVG(t.psf)::numeric, 0)::float8  AS avg_psf,
		       MAX(t.contract_date)::text             AS latest_transaction,
		       p.tenure_type, p.lease_commence_year,
		       ` + remainingLeaseSQL + ` AS remaining_lease_years
		FROM projects p
		LEFT JOIN transactions t ON t.project_id = p.id
		WHERE p.id = $1
		GROUP BY p.id`
	var p projectSummary
	if err := s.pool.QueryRow(r.Context(), q, id).Scan(
		&p.ID, &p.Source, &p.Name, &p.Street, &p.PostalCode, &p.District,
		&p.MarketSegment, &p.PropertyType, &p.Lat, &p.Lng,
		&p.TransactionCount, &p.AvgPSF, &p.LatestDate,
		&p.TenureType, &p.LeaseCommenceYear, &p.RemainingLeaseYears,
	); err != nil {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// ---- /api/projects/{id}/transactions ----

type transaction struct {
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
	// Remaining lease (in years) computed at the contract_date — derived
	// from the project's tenure_type + lease_commence_year. Null for
	// freehold / unknown-tenure projects.
	RemainingLeaseAtTxn *int32   `json:"remaining_lease_at_txn,omitempty"`
}

func (s *Server) handleProjectTransactions(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	from := r.URL.Query().Get("from") // YYYY-MM-DD or empty
	to := r.URL.Query().Get("to")

	const q = `
		SELECT t.id, t.contract_date::text, t.area_sqm::float8, t.price::float8, t.psf::float8,
		       t.floor_range, t.property_type, t.type_of_sale, t.flat_type, t.no_of_units,
		       CASE
		           WHEN p.tenure_type = '99-year'  AND p.lease_commence_year IS NOT NULL
		               THEN GREATEST(0, 99  - (EXTRACT(year FROM t.contract_date)::int - p.lease_commence_year))::int
		           WHEN p.tenure_type = '999-year' AND p.lease_commence_year IS NOT NULL
		               THEN GREATEST(0, 999 - (EXTRACT(year FROM t.contract_date)::int - p.lease_commence_year))::int
		           ELSE NULL
		       END AS remaining_lease_at_txn
		FROM transactions t
		JOIN projects p ON p.id = t.project_id
		WHERE t.project_id = $1
		  AND ($2::date IS NULL OR t.contract_date >= $2::date)
		  AND ($3::date IS NULL OR t.contract_date <= $3::date)
		ORDER BY t.contract_date DESC, t.id DESC`

	fromParam := nullStr(from)
	toParam := nullStr(to)

	rows, err := s.pool.Query(r.Context(), q, id, fromParam, toParam)
	if err != nil {
		s.logger.Error("handleProjectTransactions", "err", err)
		writeError(w, http.StatusInternalServerError, "query error")
		return
	}
	defer rows.Close()

	result := make([]transaction, 0, 64)
	for rows.Next() {
		var t transaction
		if err := rows.Scan(
			&t.ID, &t.ContractDate, &t.AreaSqm, &t.Price, &t.PSF,
			&t.FloorRange, &t.PropertyType, &t.TypeOfSale, &t.FlatType, &t.NoOfUnits,
			&t.RemainingLeaseAtTxn,
		); err != nil {
			s.logger.Error("handleProjectTransactions scan", "err", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		result = append(result, t)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "rows error")
		return
	}
	if len(result) == 0 {
		// Distinguish "project not found" from "project has no transactions"
		var exists bool
		_ = s.pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM projects WHERE id=$1)`, id).Scan(&exists)
		if !exists {
			writeError(w, http.StatusNotFound, "project not found")
			return
		}
	}
	writeJSON(w, http.StatusOK, result)
}

// ---- /api/projects/{id}/comparison ----

type ownStats struct {
	AvgPSF   *float64 `json:"avg_psf"`
	Count    int64    `json:"count"`
	DateFrom *string  `json:"date_from"`
	DateTo   *string  `json:"date_to"`
}

type nearbyStats struct {
	AvgPSF   *float64 `json:"avg_psf"`
	Count    int64    `json:"count"`
	RadiusM  int      `json:"radius_m"`
}

type comparisonResponse struct {
	ProjectID   int64        `json:"project_id"`
	Own         ownStats     `json:"own"`
	Nearby500m  nearbyStats  `json:"nearby_500m"`
	PremiumPct  *float64     `json:"premium_pct"`
}

func (s *Server) handleProjectComparison(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	var exists bool
	if err := s.pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM projects WHERE id=$1)`, id).Scan(&exists); err != nil || !exists {
		writeError(w, http.StatusNotFound, "project not found")
		return
	}

	// Own stats
	var own ownStats
	const ownQ = `
		SELECT ROUND(AVG(psf)::numeric, 0)::float8,
		       COUNT(*),
		       MIN(contract_date)::text,
		       MAX(contract_date)::text
		FROM transactions
		WHERE project_id = $1 AND psf IS NOT NULL`
	if err := s.pool.QueryRow(r.Context(), ownQ, id).Scan(
		&own.AvgPSF, &own.Count, &own.DateFrom, &own.DateTo,
	); err != nil {
		s.logger.Error("handleProjectComparison own", "err", err)
		writeError(w, http.StatusInternalServerError, "query error")
		return
	}

	// Nearby 500m stats (last 24 months)
	var nearby nearbyStats
	nearby.RadiusM = 500
	const nearbyQ = `
		SELECT ROUND(AVG(t.psf)::numeric, 0)::float8, COUNT(*)
		FROM transactions t
		JOIN projects p ON t.project_id = p.id
		WHERE t.psf IS NOT NULL
		  AND t.project_id != $1
		  AND p.geom IS NOT NULL
		  AND ST_DWithin(
		        p.geom::geography,
		        (SELECT geom::geography FROM projects WHERE id = $1),
		        500
		      )
		  AND t.contract_date >= CURRENT_DATE - INTERVAL '24 months'`
	if err := s.pool.QueryRow(r.Context(), nearbyQ, id).Scan(
		&nearby.AvgPSF, &nearby.Count,
	); err != nil {
		s.logger.Error("handleProjectComparison nearby", "err", err)
		writeError(w, http.StatusInternalServerError, "query error")
		return
	}

	resp := comparisonResponse{
		ProjectID:  id,
		Own:        own,
		Nearby500m: nearby,
	}
	if own.AvgPSF != nil && nearby.AvgPSF != nil && *nearby.AvgPSF > 0 {
		pct := math.Round((*own.AvgPSF / *nearby.AvgPSF - 1) * 1000) / 10 // 1 d.p.
		resp.PremiumPct = &pct
	}
	writeJSON(w, http.StatusOK, resp)
}

// nullStr converts an empty string to nil for use as a nullable SQL parameter.
func nullStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
