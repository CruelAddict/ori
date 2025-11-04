package rpc

import (
	"context"
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/rpc/handlers"
	"github.com/crueladdict/ori/apps/ori-server/internal/service"
	"golang.org/x/exp/jsonrpc2"
)

// Handler handles JSON-RPC requests using the jsonrpc2 library
type Handler struct {
	configService *service.ConfigService
}

// NewHandler creates a new RPC handler
func NewHandler(configService *service.ConfigService) *Handler {
	return &Handler{
		configService: configService,
	}
}

// Handle implements the jsonrpc2.Handler interface
func (h *Handler) Handle(ctx context.Context, req *jsonrpc2.Request) (interface{}, error) {
	switch req.Method {
	case "listConfigurations":
		return handlers.ListConfigurations(h.configService, req.Params)
	default:
		return nil, fmt.Errorf("%w: %s", jsonrpc2.ErrMethodNotFound, req.Method)
	}
}
