// Package metrics defines a private Prometheus registry, an HTTP middleware
// that records per-route request counts + latency, and a collector that
// exposes pgxpool stats.
//
// /metrics and /debug/pprof are mounted on the main HTTP server (see
// Handler / PprofHandler). They aren't proxied by our production nginx
// (which only forwards /api and /healthz), so they're effectively
// private — but never expose this backend port directly to the open
// internet without gating pprof first.
package metrics

import (
	"net/http"
	"net/http/pprof"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	reg = prometheus.NewRegistry()

	httpRequests = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "purepsf",
			Subsystem: "http",
			Name:      "requests_total",
			Help:      "HTTP requests handled, labeled by method, matched chi route pattern, and status code.",
		},
		[]string{"method", "route", "status"},
	)

	httpDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: "purepsf",
			Subsystem: "http",
			Name:      "request_duration_seconds",
			Help:      "End-to-end HTTP handler latency in seconds, by method + matched route.",
			Buckets:   []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10},
		},
		[]string{"method", "route"},
	)
)

func init() {
	reg.MustRegister(httpRequests, httpDuration)
	reg.MustRegister(collectors.NewGoCollector())
	reg.MustRegister(collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))
}

// RegisterPgxPool wires a Collector that turns pgxpool.Stat() into gauges on
// each scrape — connection counts, in-flight acquires, cumulative acquire
// duration, etc.
func RegisterPgxPool(pool *pgxpool.Pool) {
	reg.MustRegister(&pgxCollector{pool: pool})
}

// Middleware records request count and latency for every HTTP request that
// chi routes. Plug it into the chi router *after* the routes are registered
// so chi.RouteContext().RoutePattern() returns the matched template.
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(ww, r)

		route := chi.RouteContext(r.Context()).RoutePattern()
		if route == "" {
			// Unrouted requests (404s, OPTIONS, etc.) — bucket them so they don't
			// blow up label cardinality.
			route = "unmatched"
		}
		httpRequests.WithLabelValues(r.Method, route, strconv.Itoa(ww.status)).Inc()
		httpDuration.WithLabelValues(r.Method, route).Observe(time.Since(start).Seconds())
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (s *statusRecorder) WriteHeader(code int) {
	if !s.wrote {
		s.status = code
		s.wrote = true
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	s.wrote = true
	return s.ResponseWriter.Write(b)
}

// Handler returns the Prometheus /metrics handler bound to our private
// registry (so it doesn't leak unrelated globals from the default registry).
func Handler() http.Handler {
	return promhttp.HandlerFor(reg, promhttp.HandlerOpts{
		Registry:          reg,
		EnableOpenMetrics: true,
	})
}

// PprofHandler returns a handler that serves the standard net/http/pprof
// endpoints under any mount prefix (e.g. /debug/pprof). We register them
// onto a private ServeMux instead of using net/http/pprof's default mux
// init() to keep our handlers isolated.
func PprofHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/debug/pprof/", pprof.Index)
	mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
	mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
	mux.HandleFunc("/debug/pprof/trace", pprof.Trace)
	return mux
}

// --- pgxpool collector ---

type pgxCollector struct {
	pool *pgxpool.Pool
}

var (
	descAcquireCount = prometheus.NewDesc(
		"purepsf_pgx_acquire_total",
		"Cumulative count of successful connection acquires from the pgx pool.",
		nil, nil,
	)
	descAcquireDuration = prometheus.NewDesc(
		"purepsf_pgx_acquire_duration_seconds_total",
		"Cumulative time spent waiting for a connection from the pgx pool.",
		nil, nil,
	)
	descEmptyAcquire = prometheus.NewDesc(
		"purepsf_pgx_empty_acquire_total",
		"Cumulative acquires that had to wait because the pool was empty.",
		nil, nil,
	)
	descCanceledAcquire = prometheus.NewDesc(
		"purepsf_pgx_canceled_acquire_total",
		"Cumulative acquires that were cancelled before completion.",
		nil, nil,
	)
	descNewConns = prometheus.NewDesc(
		"purepsf_pgx_new_connections_total",
		"Cumulative connections established by the pool (excludes pre-fills).",
		nil, nil,
	)
	descTotalConns = prometheus.NewDesc(
		"purepsf_pgx_connections",
		"Connections currently held by the pool by state.",
		[]string{"state"}, nil,
	)
	descMaxConns = prometheus.NewDesc(
		"purepsf_pgx_max_connections",
		"Configured maximum connections for the pool.",
		nil, nil,
	)
)

func (c *pgxCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- descAcquireCount
	ch <- descAcquireDuration
	ch <- descEmptyAcquire
	ch <- descCanceledAcquire
	ch <- descNewConns
	ch <- descTotalConns
	ch <- descMaxConns
}

func (c *pgxCollector) Collect(ch chan<- prometheus.Metric) {
	s := c.pool.Stat()
	ch <- prometheus.MustNewConstMetric(descAcquireCount, prometheus.CounterValue, float64(s.AcquireCount()))
	ch <- prometheus.MustNewConstMetric(descAcquireDuration, prometheus.CounterValue, s.AcquireDuration().Seconds())
	ch <- prometheus.MustNewConstMetric(descEmptyAcquire, prometheus.CounterValue, float64(s.EmptyAcquireCount()))
	ch <- prometheus.MustNewConstMetric(descCanceledAcquire, prometheus.CounterValue, float64(s.CanceledAcquireCount()))
	ch <- prometheus.MustNewConstMetric(descNewConns, prometheus.CounterValue, float64(s.NewConnsCount()))
	ch <- prometheus.MustNewConstMetric(descTotalConns, prometheus.GaugeValue, float64(s.AcquiredConns()), "acquired")
	ch <- prometheus.MustNewConstMetric(descTotalConns, prometheus.GaugeValue, float64(s.IdleConns()), "idle")
	ch <- prometheus.MustNewConstMetric(descTotalConns, prometheus.GaugeValue, float64(s.ConstructingConns()), "constructing")
	ch <- prometheus.MustNewConstMetric(descTotalConns, prometheus.GaugeValue, float64(s.TotalConns()), "total")
	ch <- prometheus.MustNewConstMetric(descMaxConns, prometheus.GaugeValue, float64(s.MaxConns()))
}
