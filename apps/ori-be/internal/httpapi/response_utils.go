package httpapi

import (
	"encoding/json"
	"net/http"

	dto "github.com/crueladdict/ori/libs/contract/go"
)

func respondJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func respondError(w http.ResponseWriter, status int, code, message string, details map[string]any) {
	resp := dto.ErrorPayload{Code: code, Message: message}
	if len(details) > 0 {
		resp.Details = &details
	}
	respondJSON(w, status, resp)
}
