package httpapi

import (
	"errors"
	"net/http"
	"strings"

	dto "github.com/crueladdict/ori/libs/contract/go"
	"github.com/google/uuid"

	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/logctx"
	"github.com/crueladdict/ori/apps/ori-server/internal/service"
)

func (h *Handler) execQuery(w http.ResponseWriter, r *http.Request) {
	var payload dto.QueryExecRequest
	if err := decodeJSON(r.Body, &payload); err != nil {
		respondError(w, http.StatusBadRequest, "invalid_body", err.Error(), nil)
		return
	}

	if strings.TrimSpace(payload.ConfigurationName) == "" {
		respondError(w, http.StatusBadRequest, "missing_configuration", "configurationName is required", nil)
		return
	}
	if strings.TrimSpace(payload.Query) == "" {
		respondError(w, http.StatusBadRequest, "missing_query", "query is required", nil)
		return
	}

	jobUUID := uuid.UUID(payload.JobId)
	if jobUUID == uuid.Nil {
		respondError(w, http.StatusBadRequest, "missing_job_id", "jobId is required", nil)
		return
	}
	jobID := jobUUID.String()

	var params any

	if payload.Params != nil {
		if obj, err := payload.Params.AsQueryExecRequestParams0(); err == nil {
			params = obj
		} else if arr, err := payload.Params.AsQueryExecRequestParams1(); err == nil {
			params = arr
		} else {
			respondError(w, http.StatusBadRequest, "invalid_params", "params must be an object or array", nil)
			return
		}
	}

	var options *service.QueryExecOptions
	if payload.Options != nil {
		options = &service.QueryExecOptions{}
		if payload.Options.MaxRows != nil {
			options.MaxRows = *payload.Options.MaxRows
		}
	}

	ctx := logctx.WithField(r.Context(), "connection", payload.ConfigurationName)
	job, err := h.queries.Exec(ctx, payload.ConfigurationName, jobID, payload.Query, params, options)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrConnectionUnavailable):
			respondError(w, http.StatusConflict, "connection_not_ready", err.Error(), nil)
		case errors.Is(err, service.ErrJobAlreadyExists):
			respondError(w, http.StatusConflict, "job_already_exists", err.Error(), nil)
		default:
			respondError(w, http.StatusInternalServerError, "query_exec_failed", err.Error(), nil)
		}
		return
	}

	respondJSON(w, http.StatusAccepted, dto.QueryExecResponse{
		JobId:  job.ID,
		Status: dto.Running,
	})
}

func (h *Handler) cancelQuery(w http.ResponseWriter, r *http.Request) {
	jobID, err := decodePathParam(r, "jobId")
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_job", err.Error(), nil)
		return
	}

	job, err := h.queries.Cancel(jobID)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrJobNotFound):
			respondError(w, http.StatusNotFound, "job_not_found", err.Error(), nil)
		default:
			respondError(w, http.StatusInternalServerError, "query_cancel_failed", err.Error(), nil)
		}
		return
	}

	respondJSON(w, http.StatusAccepted, map[string]string{"status": string(job.Status)})
}
