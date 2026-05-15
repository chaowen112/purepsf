package api

import (
	"net/http"
	"strconv"
	"strings"
)

// handleAgentsList — leaderboard endpoint.
//
//	GET /api/agents?town=&property_type=&represented=&from=&to=&sort=&limit=&offset=
//
// Returns ranked salespeople with filter-scoped counts. `sort` is one of:
// total (default), hdb, condo, seller, buyer. Total count goes in
// X-Total-Count for pagination.
func (s *Server) handleAgentsList(w http.ResponseWriter, r *http.Request) {
	town := nullStr(strings.ToUpper(r.URL.Query().Get("town")))
	propertyType := nullStr(strings.ToUpper(r.URL.Query().Get("property_type")))
	represented := nullStr(strings.ToUpper(r.URL.Query().Get("represented")))
	from := nullStr(r.URL.Query().Get("from"))
	to := nullStr(r.URL.Query().Get("to"))
	limit := parseInt(r.URL.Query().Get("limit"), 50, 1, 500)
	offset := parseInt(r.URL.Query().Get("offset"), 0, 0, 1_000_000)

	sort := strings.ToLower(r.URL.Query().Get("sort"))
	sortCol := "total_txns"
	switch sort {
	case "hdb":
		sortCol = "hdb_count"
	case "condo":
		sortCol = "condo_count"
	case "seller":
		sortCol = "seller_count"
	case "buyer":
		sortCol = "buyer_count"
	}

	// Total distinct agents matching the filter — for pagination header.
	const countQ = `
		SELECT COUNT(DISTINCT t.salesperson_reg_num)
		FROM salesperson_transactions t
		WHERE ($1::text IS NULL OR t.town = $1)
		  AND ($2::text IS NULL OR t.property_type = $2)
		  AND ($3::text IS NULL OR t.represented = $3)
		  AND ($4::date IS NULL OR t.transaction_date >= $4::date)
		  AND ($5::date IS NULL OR t.transaction_date <= $5::date)`
	var total int64
	if err := s.pool.QueryRow(r.Context(), countQ, town, propertyType, represented, from, to).Scan(&total); err != nil {
		s.logger.Error("handleAgentsList count", "err", err)
		writeError(w, http.StatusInternalServerError, "query error")
		return
	}

	// Main aggregation. SortCol is whitelisted above so direct interpolation is safe.
	q := `
		WITH filtered AS (
			SELECT *
			FROM salesperson_transactions
			WHERE ($1::text IS NULL OR town = $1)
			  AND ($2::text IS NULL OR property_type = $2)
			  AND ($3::text IS NULL OR represented = $3)
			  AND ($4::date IS NULL OR transaction_date >= $4::date)
			  AND ($5::date IS NULL OR transaction_date <= $5::date)
		)
		SELECT
		    COALESCE(sp.salesperson_name, MAX(f.salesperson_name)) AS name,
		    f.salesperson_reg_num,
		    sp.estate_agent_name,
		    COUNT(*) AS total_txns,
		    COUNT(*) FILTER (WHERE f.property_type = 'HDB')                    AS hdb_count,
		    COUNT(*) FILTER (WHERE f.property_type = 'CONDOMINIUM')            AS condo_count,
		    COUNT(*) FILTER (WHERE f.property_type = 'EXECUTIVE CONDOMINIUM')  AS ec_count,
		    COUNT(*) FILTER (WHERE f.property_type = 'LANDED')                 AS landed_count,
		    COUNT(*) FILTER (WHERE f.represented   = 'SELLER')                 AS seller_count,
		    COUNT(*) FILTER (WHERE f.represented   = 'BUYER')                  AS buyer_count,
		    COUNT(*) FILTER (WHERE f.represented   = 'LANDLORD')               AS landlord_count,
		    COUNT(*) FILTER (WHERE f.represented   = 'TENANT')                 AS tenant_count,
		    -- Top towns reflect the agent's full footprint (ignoring the
		    -- town filter so the user can see specialization breadth), but
		    -- still respect the property_type / represented / date filters.
		    (SELECT array_agg(town ORDER BY n DESC)
		     FROM (
		        SELECT town, COUNT(*) AS n
		        FROM salesperson_transactions st
		        WHERE st.salesperson_reg_num = f.salesperson_reg_num
		          AND st.town IS NOT NULL
		          AND ($2::text IS NULL OR st.property_type = $2)
		          AND ($3::text IS NULL OR st.represented = $3)
		          AND ($4::date IS NULL OR st.transaction_date >= $4::date)
		          AND ($5::date IS NULL OR st.transaction_date <= $5::date)
		        GROUP BY town
		        ORDER BY n DESC
		        LIMIT 3
		     ) sub
		    ) AS top_towns
		FROM filtered f
		LEFT JOIN salespeople sp ON sp.registration_no = f.salesperson_reg_num
		GROUP BY f.salesperson_reg_num, sp.salesperson_name, sp.estate_agent_name
		ORDER BY ` + sortCol + ` DESC, total_txns DESC
		LIMIT $6 OFFSET $7`

	rows, err := s.pool.Query(r.Context(), q, town, propertyType, represented, from, to, limit, offset)
	if err != nil {
		s.logger.Error("handleAgentsList", "err", err)
		writeError(w, http.StatusInternalServerError, "query error")
		return
	}
	defer rows.Close()

	type agentLeaderRow struct {
		Name           string   `json:"name"`
		RegistrationNo string   `json:"registration_no"`
		EstateAgent    *string  `json:"estate_agent,omitempty"`
		TotalTxns      int64    `json:"total_txns"`
		HDBCount       int64    `json:"hdb_count"`
		CondoCount     int64    `json:"condo_count"`
		ECCount        int64    `json:"ec_count"`
		LandedCount    int64    `json:"landed_count"`
		SellerCount    int64    `json:"seller_count"`
		BuyerCount     int64    `json:"buyer_count"`
		LandlordCount  int64    `json:"landlord_count"`
		TenantCount    int64    `json:"tenant_count"`
		TopTowns       []string `json:"top_towns"`
	}
	out := make([]agentLeaderRow, 0, limit)
	for rows.Next() {
		var a agentLeaderRow
		if err := rows.Scan(
			&a.Name, &a.RegistrationNo, &a.EstateAgent, &a.TotalTxns,
			&a.HDBCount, &a.CondoCount, &a.ECCount, &a.LandedCount,
			&a.SellerCount, &a.BuyerCount, &a.LandlordCount, &a.TenantCount,
			&a.TopTowns,
		); err != nil {
			s.logger.Error("handleAgentsList scan", "err", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, a)
	}

	w.Header().Set("X-Total-Count", strconv.FormatInt(total, 10))
	writeJSON(w, http.StatusOK, out)
}

// handleAgentsTowns — distinct town list for the leaderboard filter dropdown.
func (s *Server) handleAgentsTowns(w http.ResponseWriter, r *http.Request) {
	const q = `SELECT town FROM salesperson_transactions
	           WHERE town IS NOT NULL GROUP BY town ORDER BY town`
	rows, err := s.pool.Query(r.Context(), q)
	if err != nil {
		s.logger.Error("handleAgentsTowns", "err", err)
		writeError(w, http.StatusInternalServerError, "query error")
		return
	}
	defer rows.Close()
	out := make([]string, 0, 32)
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, t)
	}
	writeJSON(w, http.StatusOK, out)
}
