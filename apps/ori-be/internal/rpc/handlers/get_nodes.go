package handlers

import (
	"context"
	"encoding/json"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
	"github.com/crueladdict/ori/apps/ori-server/internal/service"
	orisdk "github.com/crueladdict/ori/libs/sdk/go"
)

// GetNodesParams represents the request body for getNodes.
type GetNodesParams struct {
	ConfigurationName string   `json:"configurationName"`
	NodeIDs           []string `json:"nodeIDs,omitempty"`
}

// GetNodes handles the getNodes RPC method.
func GetNodes(ctx context.Context, nodeService *service.NodeService, raw json.RawMessage) (*orisdk.GetNodesResult, error) {
	var params GetNodesParams
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &params)
	}
	if params.ConfigurationName == "" && len(raw) > 0 {
		var positional []GetNodesParams
		if err := json.Unmarshal(raw, &positional); err == nil && len(positional) > 0 {
			params = positional[0]
		}
	}

	nodes, err := nodeService.GetNodes(ctx, params.ConfigurationName, params.NodeIDs)
	if err != nil {
		return nil, err
	}
	return &orisdk.GetNodesResult{Nodes: model.NodesToSDK(nodes, nodeService.EdgeLimit())}, nil
}
