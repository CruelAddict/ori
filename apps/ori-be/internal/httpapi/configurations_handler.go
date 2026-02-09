package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	dto "github.com/crueladdict/ori/libs/contract/go"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/logctx"
	"github.com/crueladdict/ori/apps/ori-server/internal/service"
)

type validationError struct {
	code    string
	message string
}

func (e validationError) Error() string {
	return e.message
}

const nodeIDLimit = 1000

func (h *Handler) listConfigurations(w http.ResponseWriter, r *http.Request) {
	configs, err := h.configs.ListConfigurations()
	if err != nil {
		respondError(w, http.StatusInternalServerError, "config_unavailable", err.Error(), nil)
		return
	}

	respondJSON(w, http.StatusOK, model.ConvertConfigurationsToDTO(configs))
}

func (h *Handler) getConfigurationNodes(w http.ResponseWriter, r *http.Request) {
	configurationName, nodeIDs, err := h.validateGetConfigurationNodes(r)
	if err != nil {
		if vErr, ok := err.(validationError); ok {
			respondError(w, http.StatusBadRequest, vErr.code, vErr.message, nil)
			return
		}
		respondError(w, http.StatusInternalServerError, "node_fetch_failed", err.Error(), nil)
		return
	}

	ctx := logctx.WithField(r.Context(), "connection", configurationName)
	nodes, err := h.nodes.GetNodes(ctx, configurationName, nodeIDs)
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

	converted, err := nodes.ToDTO()
	if err != nil {
		respondError(w, http.StatusInternalServerError, "node_convert_failed", err.Error(), nil)
		return
	}

	respondJSON(w, http.StatusOK, dto.NodesResponse{Nodes: converted})
}

func (h *Handler) validateGetConfigurationNodes(r *http.Request) (string, []string, error) {
	configurationName, err := decodePathParam(r, "configurationName")
	if err != nil {
		return "", nil, validationError{code: "invalid_configuration", message: err.Error()}
	}

	configurationName = strings.TrimSpace(configurationName)
	if configurationName == "" {
		return "", nil, validationError{code: "missing_configuration", message: "configurationName is required"}
	}

	nodeIDs := r.URL.Query()["nodeId"]
	if len(nodeIDs) > nodeIDLimit {
		return "", nil, validationError{code: "node_limit_exceeded", message: fmt.Sprintf("%s: limit %d", service.ErrNodeLimitExceeded, nodeIDLimit)}
	}

	trimmedNodeIDs := make([]string, len(nodeIDs))
	for i, id := range nodeIDs {
		trimmedID := strings.TrimSpace(id)
		if trimmedID == "" {
			return "", nil, validationError{code: "invalid_node_id", message: "nodeId cannot be empty"}
		}
		trimmedNodeIDs[i] = trimmedID
	}

	return configurationName, trimmedNodeIDs, nil
}
