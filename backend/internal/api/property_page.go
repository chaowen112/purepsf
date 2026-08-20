package api

import (
	"context"
	"errors"
	"fmt"
	"html/template"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"unicode"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

const propertyPageTransactionLimit = 50

type propertyPageData struct {
	ID               int64
	Source           string
	Name             string
	DisplayName      string
	Street           *string
	PostalCode       *string
	District         *string
	PropertyType     *string
	TransactionCount int64
	AvgPSF           *float64
	LatestDate       *string
	CanonicalURL     string
	Description      string
	Transactions     []propertyPageTransaction
}

type propertyPageTransaction struct {
	ContractDate string
	AreaSqm      *float64
	Price        float64
	PSF          *float64
	FloorRange   *string
	PropertyType *string
	TypeOfSale   *string
	FlatType     *string
}

type propertyPageLoader func(context.Context, int64) (propertyPageData, error)

var propertyPageTemplate = template.Must(template.New("property").Funcs(template.FuncMap{
	"money":  func(v float64) string { return fmt.Sprintf("$%.0f", v) },
	"number": func(v int64) string { return formatInt(v) },
	"area": func(v *float64) string {
		if v == nil {
			return "—"
		}
		return fmt.Sprintf("%.0f m²", *v)
	},
	"text": func(v *string) string {
		if v == nil || *v == "" {
			return "—"
		}
		return *v
	},
	"transactionDetail": func(t propertyPageTransaction) string {
		parts := make([]string, 0, 3)
		for _, value := range []*string{t.FlatType, t.FloorRange, t.TypeOfSale, t.PropertyType} {
			if value != nil && *value != "" {
				parts = append(parts, *value)
			}
		}
		if len(parts) == 0 {
			return "—"
		}
		return strings.Join(parts, " · ")
	},
}).Parse(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="index, follow">
    <title>{{.DisplayName}} property transactions | purePSF</title>
    <meta name="description" content="{{.Description}}">
    <link rel="canonical" href="{{.CanonicalURL}}">
    <meta property="og:site_name" content="purePSF">
    <meta property="og:type" content="article">
    <meta property="og:title" content="{{.DisplayName}} property transactions | purePSF">
    <meta property="og:description" content="{{.Description}}">
    <meta property="og:url" content="{{.CanonicalURL}}">
    <meta name="twitter:card" content="summary">
    <script type="module" crossorigin src="/assets/app.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/app.css">
  </head>
  <body class="bg-slate-50">
    <div id="root">
      <header>
        <a href="/">purePSF</a>
      </header>
      <main>
        <article>
          <h1>{{.DisplayName}}</h1>
          <p>
            {{if .Street}}{{.Street}}{{end}}{{if .PostalCode}}{{if .Street}}, {{end}}Singapore {{.PostalCode}}{{end}}
          </p>
          <p>
            {{number .TransactionCount}} recorded {{.Source}} transactions{{if .AvgPSF}}, average PSF {{money .AvgPSF}}{{end}}{{if .LatestDate}}, latest {{.LatestDate}}{{end}}.
          </p>
          <section aria-labelledby="transaction-history">
            <h2 id="transaction-history">Transaction history</h2>
            {{if .Transactions}}
            <table>
              <thead>
                <tr><th>Date</th><th>Area</th><th>Price</th><th>PSF</th><th>Detail</th></tr>
              </thead>
              <tbody>
                {{range .Transactions}}
                <tr>
                  <td>{{.ContractDate}}</td>
                  <td>{{area .AreaSqm}}</td>
                  <td>{{money .Price}}</td>
                  <td>{{if .PSF}}{{money .PSF}}{{else}}—{{end}}</td>
                  <td>{{transactionDetail .}}</td>
                </tr>
                {{end}}
              </tbody>
            </table>
            {{else}}
            <p>No recorded transactions.</p>
            {{end}}
          </section>
        </article>
      </main>
    </div>
  </body>
</html>`))

var propertyNotFoundTemplate = template.Must(template.New("not-found").Parse(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex">
    <title>Property not found | purePSF</title>
  </head>
  <body>
    <main>
      <h1>Property not found</h1>
      <p>The requested property does not exist.</p>
      <p><a href="/">Back to the map</a></p>
    </main>
  </body>
</html>`))

func (s *Server) handlePropertyPage(w http.ResponseWriter, r *http.Request) {
	propertyPageHandler(s.queryPropertyPage, s.logger).ServeHTTP(w, r)
}

func propertyPageHandler(load propertyPageLoader, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
		if err != nil || id <= 0 {
			writePropertyNotFound(w)
			return
		}

		page, err := load(r.Context(), id)
		if errors.Is(err, pgx.ErrNoRows) {
			writePropertyNotFound(w)
			return
		}
		if err != nil {
			logger.Error("property page query", "project_id", id, "err", err)
			http.Error(w, "property page query error", http.StatusInternalServerError)
			return
		}

		canonicalPath := canonicalPropertyPath(page.ID, page.Name)
		if r.URL.Path != canonicalPath {
			http.Redirect(w, r, canonicalPath, http.StatusPermanentRedirect)
			return
		}

		page.DisplayName = displayProjectName(page.Source, page.Name)
		page.CanonicalURL = siteBase + canonicalPath
		page.Description = propertyDescription(page)

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=300")
		if err := propertyPageTemplate.Execute(w, page); err != nil {
			logger.Error("render property page", "project_id", id, "err", err)
		}
	}
}

func (s *Server) queryPropertyPage(ctx context.Context, id int64) (propertyPageData, error) {
	var page propertyPageData
	err := s.pool.QueryRow(ctx, `
		SELECT p.id, p.source::text, p.name, p.street, p.postal_code, p.district,
		       p.property_type, COUNT(t.id), ROUND(AVG(t.psf)::numeric, 0)::float8,
		       MAX(t.contract_date)::text
		FROM projects p
		LEFT JOIN transactions t ON t.project_id = p.id
		WHERE p.id = $1
		GROUP BY p.id`, id).Scan(
		&page.ID, &page.Source, &page.Name, &page.Street, &page.PostalCode,
		&page.District, &page.PropertyType, &page.TransactionCount, &page.AvgPSF,
		&page.LatestDate,
	)
	if err != nil {
		return propertyPageData{}, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT t.contract_date::text, t.area_sqm::float8, t.price::float8,
		       t.psf::float8, t.floor_range, t.property_type, t.type_of_sale,
		       t.flat_type
		FROM transactions t
		WHERE t.project_id = $1
		ORDER BY t.contract_date DESC, t.id DESC
		LIMIT $2`, id, propertyPageTransactionLimit)
	if err != nil {
		return propertyPageData{}, err
	}
	defer rows.Close()

	page.Transactions = make([]propertyPageTransaction, 0, propertyPageTransactionLimit)
	for rows.Next() {
		var transaction propertyPageTransaction
		if err := rows.Scan(
			&transaction.ContractDate, &transaction.AreaSqm, &transaction.Price,
			&transaction.PSF, &transaction.FloorRange, &transaction.PropertyType,
			&transaction.TypeOfSale, &transaction.FlatType,
		); err != nil {
			return propertyPageData{}, err
		}
		page.Transactions = append(page.Transactions, transaction)
	}
	if err := rows.Err(); err != nil {
		return propertyPageData{}, err
	}
	return page, nil
}

func writePropertyNotFound(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNotFound)
	_ = propertyNotFoundTemplate.Execute(w, nil)
}

func canonicalPropertyPath(id int64, name string) string {
	return fmt.Sprintf("/p/%d/%s", id, slugify(name))
}

func propertyDescription(page propertyPageData) string {
	bits := []string{
		fmt.Sprintf("%s.", page.DisplayName),
		fmt.Sprintf("%s recorded %s transactions", formatInt(page.TransactionCount), page.Source),
	}
	if page.AvgPSF != nil {
		bits = append(bits, fmt.Sprintf("average PSF $%.0f", *page.AvgPSF))
	}
	if page.LatestDate != nil {
		bits = append(bits, "latest "+*page.LatestDate)
	}
	return strings.Join(bits, " · ")
}

func displayProjectName(source, name string) string {
	if source != "HDB" {
		return name
	}

	expansions := map[string]string{
		"BLK": "Blk", "ST": "Street", "RD": "Road", "AVE": "Avenue",
		"DR": "Drive", "CRES": "Crescent", "CTRL": "Central",
		"NTH": "North", "STH": "South", "UPP": "Upper",
	}
	words := strings.Fields(name)
	for i, word := range words {
		upper := strings.ToUpper(word)
		if expanded, ok := expansions[upper]; ok {
			words[i] = expanded
			continue
		}
		words[i] = titleWord(word)
	}
	return strings.Join(words, " ")
}

func titleWord(word string) string {
	runes := []rune(strings.ToLower(word))
	for i, r := range runes {
		if unicode.IsLetter(r) {
			runes[i] = unicode.ToUpper(r)
			break
		}
	}
	return string(runes)
}

func formatInt(value int64) string {
	digits := strconv.FormatInt(value, 10)
	if len(digits) <= 3 {
		return digits
	}
	start := len(digits) % 3
	if start == 0 {
		start = 3
	}
	var b strings.Builder
	b.WriteString(digits[:start])
	for i := start; i < len(digits); i += 3 {
		b.WriteByte(',')
		b.WriteString(digits[i : i+3])
	}
	return b.String()
}
