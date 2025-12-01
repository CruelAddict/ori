package httpapi

import (
	"errors"
	"net/http"

	dto "github.com/crueladdict/ori/libs/contract/go"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
	"github.com/crueladdict/ori/apps/ori-server/internal/service"
)

func (h *Handler) listConfigurations(w http.ResponseWriter, r *http.Request) {
	configs, err := h.configs.ListConfigurations()
	if err != nil {
		respondError(w, http.StatusInternalServerError, "config_unavailable", err.Error(), nil)
		return
	}

	respondJSON(w, http.StatusOK, model.ConvertConfigurationsToDTO(configs))
}

func (h *Handler) getConfigurationNodes(w http.ResponseWriter, r *http.Request) {
	configurationName, err := decodePathParam(r, "configurationName")
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_configuration", err.Error(), nil)
		return
	}

	nodeIDs := r.URL.Query()["nodeId"]
	nodes, err := h.nodes.GetNodes(r.Context(), configurationName, nodeIDs)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrConnectionUnavailable):
			respondError(w, http.StatusConflict, "connection_not_ready", err.Error(), nil)
		case errors.Is(err, service.ErrNodeLimitExceeded):
			respondError(w, http.StatusBadRequest, "node_limit_exceeded", err.Error(), nil)
		case errors.Is(err, service.ErrUnknownNode):
			respondError(w, http.StatusNotFound, "node_not_found", err.Error(), nil)
		default:
			respondError(w, http.StatusInternalServerError, "node_fetch_failed", err.Error(), nil)
		}
		return
	}

	respondJSON(w, http.StatusOK, dto.NodesResponse{
		Nodes: model.ConvertNodesToDTO(nodes, h.nodes.EdgeLimit()),
	})
}
