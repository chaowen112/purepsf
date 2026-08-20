package api

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

func TestPropertyPageHandlerRendersCrawlableHTML(t *testing.T) {
	avgPSF := 265.0
	latest := "2026-03-01"
	area := 134.0
	psf := 485.31
	flatType := "5 ROOM"
	load := func(context.Context, int64) (propertyPageData, error) {
		return propertyPageData{
			ID:               10005,
			Source:           "HDB",
			Name:             "BLK 148 YISHUN ST 11",
			TransactionCount: 281,
			AvgPSF:           &avgPSF,
			LatestDate:       &latest,
			Transactions: []propertyPageTransaction{{
				ContractDate: "2026-03-01", AreaSqm: &area, Price: 700000,
				PSF: &psf, FlatType: &flatType,
			}},
		}, nil
	}

	router := propertyTestRouter(load)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/p/10005/blk-148-yishun-st-11", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	body := recorder.Body.String()
	for _, want := range []string{
		`<link rel="canonical" href="https://purepsf.tet.sg/p/10005/blk-148-yishun-st-11">`,
		`<h1>Blk 148 Yishun Street 11</h1>`,
		`<h2 id="transaction-history">Transaction history</h2>`,
		`<td>2026-03-01</td>`,
		`<td>134 m²</td>`,
		`average PSF $265`,
		`src="/assets/app.js"`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("response missing %q", want)
		}
	}
}

func TestPropertyPageHandlerReturns404ForMissingProperty(t *testing.T) {
	load := func(context.Context, int64) (propertyPageData, error) {
		return propertyPageData{}, pgx.ErrNoRows
	}

	recorder := httptest.NewRecorder()
	propertyTestRouter(load).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/p/999999999/definitely-missing", nil))

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), `<meta name="robots" content="noindex">`) {
		t.Error("404 response missing noindex")
	}
}

func TestPropertyPageHandlerRedirectsNonCanonicalSlug(t *testing.T) {
	load := func(context.Context, int64) (propertyPageData, error) {
		return propertyPageData{ID: 10005, Source: "HDB", Name: "BLK 148 YISHUN ST 11"}, nil
	}

	recorder := httptest.NewRecorder()
	propertyTestRouter(load).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/p/10005/wrong", nil))

	if recorder.Code != http.StatusPermanentRedirect {
		t.Fatalf("status = %d, want 308", recorder.Code)
	}
	if got := recorder.Header().Get("Location"); got != "/p/10005/blk-148-yishun-st-11" {
		t.Fatalf("location = %q", got)
	}
}

func TestPropertyPageHandlerReturns500ForDatabaseFailure(t *testing.T) {
	load := func(context.Context, int64) (propertyPageData, error) {
		return propertyPageData{}, errors.New("database unavailable")
	}

	recorder := httptest.NewRecorder()
	propertyTestRouter(load).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/p/10005/blk-148-yishun-st-11", nil))

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", recorder.Code)
	}
}

func TestDisplayProjectName(t *testing.T) {
	if got := displayProjectName("HDB", "BLK 148 YISHUN ST 11"); got != "Blk 148 Yishun Street 11" {
		t.Fatalf("displayProjectName = %q", got)
	}
	if got := displayProjectName("URA", "D'LEEDON"); got != "D'LEEDON" {
		t.Fatalf("URA name changed: %q", got)
	}
}

func propertyTestRouter(load propertyPageLoader) http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	router := chi.NewRouter()
	router.Get("/p/{id}/{slug}", propertyPageHandler(load, logger))
	return router
}
