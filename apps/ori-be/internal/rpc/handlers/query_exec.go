package handlers

import (
	"encoding/json"

	orisdk "github.com/crueladdict/ori/libs/sdk/go"

	"github.com/crueladdict/ori/apps/ori-server/internal/service"
)

// QueryExec handles the query.exec RPC method
func QueryExec(queryService *service.QueryService, raw json.RawMessage) (*orisdk.QueryExecResult, error) {
	var params orisdk.QueryExecParams
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &params); err != nil {
			return nil, err
		}
	}

	// Handle positional parameters in array form
	if params.ConfigurationName == "" {
		var arr []orisdk.QueryExecParams
		if err := json.Unmarshal(raw, &arr); err == nil && len(arr) > 0 {
			params = arr[0]
		} else {
			return nil, &json.InvalidUnmarshalError{}
		}
	}

	var options *service.QueryExecOptions
	if params.Options != nil {
		options = &service.QueryExecOptions{
			MaxRows: params.Options.MaxRows,
		}
	}

	job, err := queryService.Exec(params.ConfigurationName, params.Query, params.Params, options)
	if err != nil {
		return &orisdk.QueryExecResult{
			JobID:   "",
			Status:  "failed",
			Message: err.Error(),
		}, nil
	}

	result := &orisdk.QueryExecResult{
		JobID:  job.ID,
		Status: "running",
	}
	return result, nil
}
