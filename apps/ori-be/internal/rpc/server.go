package rpc

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"time"

	"golang.org/x/exp/jsonrpc2"
)

// Server represents the JSON-RPC HTTP server
type Server struct {
	handler    *Handler
	httpServer *http.Server
	listener   net.Listener
	socketPath string
}

// JSONRPCRequest represents a JSON-RPC 2.0 request (for HTTP compatibility)
type JSONRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
	ID      interface{}     `json:"id"`
}

// JSONRPCResponse represents a JSON-RPC 2.0 response (for HTTP compatibility)
type JSONRPCResponse struct {
	JSONRPC string      `json:"jsonrpc"`
	Result  interface{} `json:"result,omitempty"`
	Error   *RPCError   `json:"error,omitempty"`
	ID      interface{} `json:"id"`
}

// RPCError represents a JSON-RPC 2.0 error
type RPCError struct {
	Code    int64       `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

// NewServer creates a new RPC server that handles HTTP requests over TCP
func NewServer(ctx context.Context, handler *Handler, port int) (*Server, error) {
	s := &Server{
		handler: handler,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/rpc", s.handleHTTPRequest)
	mux.HandleFunc("/healthcheck", s.handleHealthRequest)

	s.httpServer = &http.Server{
		Addr:         fmt.Sprintf(":%d", port),
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Use a channel to detect startup errors
	errChan := make(chan error, 1)

	// Start HTTP server in background
	go func() {
		if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errChan <- err
		}
	}()

	// Wait briefly to check if the server started successfully
	select {
	case err := <-errChan:
		return nil, fmt.Errorf("failed to start server: %w", err)
	case <-time.After(100 * time.Millisecond):
		// Server started successfully
		return s, nil
	}
}

// NewUnixServer creates a new RPC server that handles HTTP requests over a Unix domain socket
func NewUnixServer(ctx context.Context, handler *Handler, socketPath string) (*Server, error) {
	s := &Server{
		handler:    handler,
		socketPath: socketPath,
	}

	// Remove stale socket if exists
	_ = os.Remove(socketPath)

	ln, err := net.Listen("unix", socketPath)
	if err != nil {
		return nil, fmt.Errorf("failed to listen on unix socket %s: %w", socketPath, err)
	}
	// Keep reference for shutdown cleanup
	s.listener = ln

	mux := http.NewServeMux()
	mux.HandleFunc("/rpc", s.handleHTTPRequest)
	mux.HandleFunc("/healthcheck", s.handleHealthRequest)

	s.httpServer = &http.Server{
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	errChan := make(chan error, 1)
	go func() {
		if err := s.httpServer.Serve(ln); err != nil && err != http.ErrServerClosed {
			errChan <- err
		}
	}()

	select {
	case err := <-errChan:
		return nil, fmt.Errorf("failed to start unix server: %w", err)
	case <-time.After(100 * time.Millisecond):
		return s, nil
	}
}

// handleHTTPRequest handles individual HTTP requests
func (s *Server) handleHTTPRequest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req JSONRPCRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, nil, -32700, "Parse error")
		return
	}

	if req.JSONRPC != "2.0" {
		s.sendError(w, req.ID, -32600, "Invalid Request")
		return
	}

	// Convert to jsonrpc2.Request
	var id jsonrpc2.ID
	switch v := req.ID.(type) {
	case float64:
		id = jsonrpc2.Int64ID(int64(v))
	case string:
		id = jsonrpc2.StringID(v)
	case nil:
		// Notification - no ID
	default:
		s.sendError(w, req.ID, -32600, "Invalid Request ID")
		return
	}

	jsonReq := &jsonrpc2.Request{
		ID:     id,
		Method: req.Method,
		Params: req.Params,
	}

	// Call the handler
	result, err := s.handler.Handle(r.Context(), jsonReq)
	if err != nil {
		s.sendError(w, req.ID, -32603, err.Error())
		return
	}

	// Send successful response
	s.sendResult(w, req.ID, result)
}

// handleHealthRequest is a simple health endpoint used by the CLI to detect live daemons
func (s *Server) handleHealthRequest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

// sendResult sends a successful JSON-RPC response
func (s *Server) sendResult(w http.ResponseWriter, id interface{}, result interface{}) {
	resp := JSONRPCResponse{
		JSONRPC: "2.0",
		Result:  result,
		ID:      id,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// sendError sends an error JSON-RPC response
func (s *Server) sendError(w http.ResponseWriter, id interface{}, code int64, message string) {
	resp := JSONRPCResponse{
		JSONRPC: "2.0",
		Error: &RPCError{
			Code:    code,
			Message: message,
		},
		ID: id,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// Wait blocks until the server shuts down
func (s *Server) Wait() error {
	// For HTTP server, this is a no-op as we handle shutdown differently
	return nil
}

// Shutdown gracefully shuts down the server and removes the unix socket if used
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

// Addr returns the server address
func (s *Server) Addr() string {
	if s.socketPath != "" {
		return s.socketPath
	}
	return s.httpServer.Addr
}
