package handlers

import (
	"context"
	"encoding/json"

	orisdk "github.com/crueladdict/ori/libs/sdk/go"

	"github.com/crueladdict/ori/apps/ori-server/internal/service"
)

type ConnectParams struct {
	ConfigurationName string `json:"configurationName"`
}

func Connect(ctx context.Context, connectionService *service.ConnectionService, raw json.RawMessage) (*orisdk.ConnectResult, error) {
	var params ConnectParams
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &params)
	}
	// In positional form, raw may be a single-element array; try to decode that as well
	if params.ConfigurationName == "" {
		var arr []ConnectParams
		if err := json.Unmarshal(raw, &arr); err == nil && len(arr) > 0 {
			params = arr[0]
		}
	}

	out := connectionService.Connect(ctx, params.ConfigurationName)
	res := &orisdk.ConnectResult{Result: out.Result}
	if out.UserMessage != "" {
		msg := out.UserMessage
		res.UserMessage = &msg
	}
	return res, nil
}
