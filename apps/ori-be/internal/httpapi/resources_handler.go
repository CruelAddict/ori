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

func (h *Handler) listResources(w http.ResponseWriter, r *http.Request) {
	configs, err := h.configs.ListResources()
	if err != nil {
		respondError(w, http.StatusInternalServerError, "resource_unavailable", err.Error(), nil)
		return
	}

	respondJSON(w, http.StatusOK, model.ConvertResourcesToDTO(configs))
}

func (h *Handler) getResourceNodes(w http.ResponseWriter, r *http.Request) {
	resourceName, nodeIDs, err := h.validateGetResourceNodes(r)
	if err != nil {
		if vErr, ok := err.(validationError); ok {
			respondError(w, http.StatusBadRequest, vErr.code, vErr.message, nil)
			return
		}
		respondError(w, http.StatusInternalServerError, "node_fetch_failed", err.Error(), nil)
		return
	}

	ctx := logctx.WithField(r.Context(), "resource", resourceName)
	nodes, err := h.nodes.GetNodes(ctx, resourceName, nodeIDs)
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

func (h *Handler) validateGetResourceNodes(r *http.Request) (string, []string, error) {
	resourceName, err := decodePathParam(r, "resourceName")
	if err != nil {
		return "", nil, validationError{code: "invalid_resource", message: err.Error()}
	}

	resourceName = strings.TrimSpace(resourceName)
	if resourceName == "" {
		return "", nil, validationError{code: "missing_resource", message: "resourceName is required"}
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

	return resourceName, trimmedNodeIDs, nil
}
