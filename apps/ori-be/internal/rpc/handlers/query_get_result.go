package handlers

import (
	"encoding/json"

	orisdk "github.com/crueladdict/ori/libs/sdk/go"

	"github.com/crueladdict/ori/apps/ori-server/internal/service"
)

// QueryGetResult handles the query.getResult RPC method
func QueryGetResult(queryService *service.QueryService, raw json.RawMessage) (*orisdk.QueryGetResultResult, error) {
	var params orisdk.QueryGetResultParams
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &params); err != nil {
			return nil, err
		}
	}

	// Handle positional parameters in array form
	if params.JobID == "" {
		var arr []orisdk.QueryGetResultParams
		if err := json.Unmarshal(raw, &arr); err == nil && len(arr) > 0 {
			params = arr[0]
		} else {
			return nil, &json.InvalidUnmarshalError{}
		}
	}

	view, err := queryService.BuildResultView(params.JobID, params.Limit, params.Offset)
	if err != nil {
		return nil, err
	}

	columns := make([]orisdk.QueryResultColumn, len(view.Columns))
	for i, col := range view.Columns {
		columns[i] = orisdk.QueryResultColumn{
			Name: col.Name,
			Type: col.Type,
		}
	}

	result := &orisdk.QueryGetResultResult{
		Columns:   columns,
		Rows:      view.Rows,
		RowCount:  view.RowCount,
		Truncated: view.Truncated,
	}
	return result, nil
}
