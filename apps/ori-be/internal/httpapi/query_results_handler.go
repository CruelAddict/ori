package httpapi

import (
	"errors"
	"net/http"

	dto "github.com/crueladdict/ori/libs/contract/go"

	"github.com/crueladdict/ori/apps/ori-server/internal/service"
)

func (h *Handler) getQueryResult(w http.ResponseWriter, r *http.Request) {
	jobID, err := decodePathParam(r, "jobID")
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_job", err.Error(), nil)
		return
	}

	limit, err := optionalInt(r.URL.Query().Get("limit"), 1)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_limit", err.Error(), nil)
		return
	}

	offset, err := optionalInt(r.URL.Query().Get("offset"), 0)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_offset", err.Error(), nil)
		return
	}

	view, err := h.queries.BuildResultView(r.Context(), jobID, limit, offset)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrNotFound):
			respondError(w, http.StatusNotFound, "job_not_found", err.Error(), nil)
		default:
			respondError(w, http.StatusBadRequest, "result_unavailable", err.Error(), nil)
		}
		return
	}

	columns := make([]dto.QueryResultColumn, len(view.Columns))
	for i, col := range view.Columns {
		columns[i] = dto.QueryResultColumn{Name: col.Name, Type: col.Type}
	}

	respondJSON(w, http.StatusOK, dto.QueryResultResponse{
		Columns:      columns,
		Rows:         view.Rows,
		RowCount:     view.RowCount,
		Truncated:    view.Truncated,
		RowsAffected: toIntPtr(view.RowsAffected),
	})
}

func toIntPtr(value *int64) *int {
	if value == nil {
		return nil
	}
	v := int(*value)
	return &v
}
