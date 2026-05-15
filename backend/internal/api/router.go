package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/chaowenchen/purepsf/backend/internal/metrics"
)

type Server struct {
	pool   *pgxpool.Pool
	logger *slog.Logger
}

func NewRouter(pool *pgxpool.Pool, logger *slog.Logger) http.Handler {
	s := &Server{pool: pool, logger: logger}

	r := chi.NewRouter()
	r.Use(middleware.Recoverer)

	// Observability: nginx in production only proxies /api and /healthz, so
	// these stay private. They sit outside the metrics.Middleware group so
	// Prometheus scrapes and pprof traces don't pollute our latency
	// histograms or request counts.
	r.Method(http.MethodGet, "/metrics", metrics.Handler())
	r.Mount("/debug", metrics.PprofHandler())

	// App routes: full middleware stack.
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequestID)
		r.Use(middleware.RealIP)
		r.Use(middleware.Timeout(20 * time.Second))
		r.Use(corsMiddleware)
		r.Use(metrics.Middleware)

		r.Get("/healthz", s.handleHealth)
		r.Route("/api", func(r chi.Router) {
			r.Get("/projects", s.handleListProjects)
			r.Get("/projects/{id}/transactions", s.handleProjectTransactions)
			r.Get("/projects/{id}/comparison", s.handleProjectComparison)
			r.Get("/tracked", s.handleTracked)
			r.Get("/subzones/stats", s.handleSubzoneStats)
			r.Get("/subzones/{id}", s.handleSubzoneSummary)
			r.Get("/subzones/{id}/transactions", s.handleSubzoneTransactions)
			r.Get("/subzones/{id}/psf-timeseries", s.handleSubzoneTimeseries)
			r.Get("/subzones/{id}/agents", s.handleSubzoneAgents)
			r.Get("/agents", s.handleAgentsList)
			r.Get("/agents/towns", s.handleAgentsTowns)
		})
	})
	return r
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if err := s.pool.Ping(r.Context()); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "db_down"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}


func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
