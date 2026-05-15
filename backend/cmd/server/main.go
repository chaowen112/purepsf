package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/chaowenchen/purepsf/backend/internal/api"
	"github.com/chaowenchen/purepsf/backend/internal/db"
	"github.com/chaowenchen/purepsf/backend/internal/metrics"
)

func main() {
	logger := newLogger(os.Getenv("BACKEND_LOG_LEVEL"))
	slog.SetDefault(logger)

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		logger.Error("DATABASE_URL not set")
		os.Exit(1)
	}

	pool, err := db.NewPool(context.Background(), databaseURL)
	if err != nil {
		logger.Error("db connect failed", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	metrics.RegisterPgxPool(pool)

	port := os.Getenv("BACKEND_PORT")
	if port == "" {
		port = "8080"
	}

	// Debug server: /metrics + /debug/pprof. Bind to loopback by default so
	// pprof and pool internals aren't exposed publicly. Override with
	// BACKEND_DEBUG_ADDR=0.0.0.0:9090 when running behind a trusted network.
	debugAddr := os.Getenv("BACKEND_DEBUG_ADDR")
	if debugAddr == "" {
		debugAddr = "127.0.0.1:9090"
	}
	debugCtx, debugCancel := context.WithCancel(context.Background())
	defer debugCancel()
	go func() {
		if err := metrics.Serve(debugCtx, debugAddr, logger); err != nil {
			logger.Error("debug server error", "err", err)
		}
	}()

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           api.NewRouter(pool, logger),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		logger.Info("backend listening", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	logger.Info("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("shutdown error", "err", err)
	}
}

func newLogger(level string) *slog.Logger {
	var lvl slog.Level
	switch strings.ToLower(level) {
	case "debug":
		lvl = slog.LevelDebug
	case "warn":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	default:
		lvl = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: lvl}))
}
