package httpapi

import (
	"net/http"
	"strings"

	dto "github.com/crueladdict/ori/libs/contract/go"
)

func (h *Handler) startConnection(w http.ResponseWriter, r *http.Request) {
	var payload dto.ConnectionRequest
	if err := decodeJSON(r.Body, &payload); err != nil {
		respondError(w, http.StatusBadRequest, "invalid_body", err.Error(), nil)
		return
	}

	name := strings.TrimSpace(payload.ConfigurationName)
	if name == "" {
		respondError(w, http.StatusBadRequest, "missing_configuration", "configurationName is required", nil)
		return
	}

	if _, err := h.configs.ByName(name); err != nil {
		respondError(w, http.StatusNotFound, "configuration_not_found", err.Error(), nil)
		return
	}

	outcome := h.connections.Connect(r.Context(), name)
	result := dto.ConnectionResult{Result: dto.ConnectionResultResult(outcome.Result)}
	if outcome.UserMessage != "" {
		result.UserMessage = &outcome.UserMessage
	}

	respondJSON(w, http.StatusCreated, result)
}
