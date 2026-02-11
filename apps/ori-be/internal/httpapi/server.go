package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/crueladdict/ori/apps/ori-server/internal/events"
)

// Server exposes the HTTP API and SSE endpoints using the standard library.
type Server struct {
	handler    *Handler
	events     *events.Hub
	httpServer *http.Server
	listener   net.Listener
	socketPath string
}

func NewServer(ctx context.Context, handler *Handler, eventsHub *events.Hub, port int) (*Server, error) {
	s := &Server{handler: handler, events: eventsHub}
	mux := s.buildMux()
	s.httpServer = &http.Server{
		Addr:         fmt.Sprintf(":%d", port),
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}
	if err := s.start(ctx); err != nil {
		return nil, err
	}
	return s, nil
}

func NewUnixServer(ctx context.Context, handler *Handler, eventsHub *events.Hub, socketPath string) (*Server, error) {
	s := &Server{handler: handler, events: eventsHub, socketPath: socketPath}
	_ = os.Remove(socketPath)
	ln, err := net.Listen("unix", socketPath)
	if err != nil {
		return nil, fmt.Errorf("failed to listen on unix socket %s: %w", socketPath, err)
	}
	s.listener = ln
	mux := s.buildMux()
	s.httpServer = &http.Server{
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}
	if err := s.startUnix(ctx); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Server) buildMux() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /events", s.handleEvents)
	mux.HandleFunc("GET /configurations", s.handler.listConfigurations)
	mux.HandleFunc("GET /configurations/{configurationName}/nodes", s.handler.getConfigurationNodes)
	mux.HandleFunc("POST /connections", s.handler.startConnection)
	mux.HandleFunc("POST /queries", s.handler.execQuery)
	mux.HandleFunc("POST /queries/{jobId}/cancel", s.handler.cancelQuery)
	mux.HandleFunc("GET /queries/{jobId}/result", s.handler.getQueryResult)
	return mux
}

func (s *Server) start(ctx context.Context) error {
	errCh := make(chan error, 1)
	go func() {
		if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()
	select {
	case err := <-errCh:
		return fmt.Errorf("failed to start server: %w", err)
	case <-time.After(100 * time.Millisecond):
		return nil
	}
}

func (s *Server) startUnix(ctx context.Context) error {
	errCh := make(chan error, 1)
	go func() {
		if err := s.httpServer.Serve(s.listener); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()
	select {
	case err := <-errCh:
		return fmt.Errorf("failed to start unix server: %w", err)
	case <-time.After(100 * time.Millisecond):
		return nil
	}
}

func (s *Server) Shutdown() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := s.httpServer.Shutdown(ctx)
	if s.listener != nil {
		_ = s.listener.Close()
	}
	if s.socketPath != "" {
		_ = os.Remove(s.socketPath)
	}
	return err
}

func (s *Server) Wait() error {
	return nil
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	if s.events == nil {
		http.Error(w, "event stream unavailable", http.StatusServiceUnavailable)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	rc := http.NewResponseController(w)
	ctx := r.Context()
	if err := rc.SetWriteDeadline(time.Time{}); err != nil {
		slog.WarnContext(ctx, "failed to disable write deadline for SSE", slog.Any("err", err))
	}

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	eventCh, unsubscribe := s.events.Subscribe()
	defer unsubscribe()

	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	if _, err := w.Write([]byte(": connected\n\n")); err == nil {
		flusher.Flush()
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-heartbeat.C:
			if _, err := w.Write([]byte(": ping\n\n")); err != nil {
				slog.DebugContext(ctx, "sse heartbeat write failed", slog.Any("err", err))
				return
			}
			flusher.Flush()
		case evt, ok := <-eventCh:
			if !ok {
				return
			}
			payload, err := json.Marshal(evt.Payload)
			if err != nil {
				slog.ErrorContext(ctx, "failed to marshal sse payload", slog.Any("err", err))
				continue
			}
			if !evt.Timestamp.IsZero() {
				if _, err := fmt.Fprintf(w, "id: %d\n", evt.Timestamp.UnixNano()); err != nil {
					slog.DebugContext(ctx, "failed to write sse id", slog.Any("err", err))
					return
				}
			}
			if evt.Name != "" {
				if _, err := fmt.Fprintf(w, "event: %s\n", evt.Name); err != nil {
					slog.DebugContext(ctx, "failed to write sse event", slog.Any("err", err))
					return
				}
			}
			if _, err := fmt.Fprintf(w, "data: %s\n\n", payload); err != nil {
				slog.DebugContext(ctx, "failed to write sse data", slog.Any("err", err))
				return
			}
			flusher.Flush()
		}
	}
}
