package httpapi

import (
	"net/http"
	"strings"

	dto "github.com/crueladdict/ori/libs/contract/go"

	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/logctx"
)

func (h *Handler) connectResource(w http.ResponseWriter, r *http.Request) {
	var payload dto.ResourceConnectRequest
	if err := decodeJSON(r.Body, &payload); err != nil {
		respondError(w, http.StatusBadRequest, "invalid_body", err.Error(), nil)
		return
	}

	name := strings.TrimSpace(payload.ResourceName)
	if name == "" {
		respondError(w, http.StatusBadRequest, "missing_resource", "resourceName is required", nil)
		return
	}

	if _, err := h.configs.ByName(name); err != nil {
		respondError(w, http.StatusNotFound, "resource_not_found", err.Error(), nil)
		return
	}

	ctx := logctx.WithField(r.Context(), "resource", name)
	outcome := h.connections.Connect(ctx, name)
	result := dto.ResourceConnectResult{Result: dto.ResourceConnectResultResult(outcome.Result)}
	if outcome.UserMessage != "" {
		result.UserMessage = &outcome.UserMessage
	}

	respondJSON(w, http.StatusCreated, result)
}
