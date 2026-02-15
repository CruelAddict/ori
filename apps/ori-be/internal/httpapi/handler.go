package httpapi

import (
	"github.com/crueladdict/ori/apps/ori-server/internal/service"
)

// Handler wires HTTP requests to domain services.
type Handler struct {
	configs     *service.ResourceCatalogService
	connections *service.ResourceSessionService
	nodes       *service.NodeService
	queries     *service.QueryService
}

func NewHandler(configs *service.ResourceCatalogService, connections *service.ResourceSessionService, nodes *service.NodeService, queries *service.QueryService) *Handler {
	return &Handler{
		configs:     configs,
		connections: connections,
		nodes:       nodes,
		queries:     queries,
	}
}
