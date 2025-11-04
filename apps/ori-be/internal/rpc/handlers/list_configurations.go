package handlers

import (
	"encoding/json"

	"github.com/crueladdict/ori/apps/ori-server/internal/service"
	orisdk "github.com/crueladdict/ori/libs/sdk/go"
)

// ListConfigurations handles the listConfigurations RPC method
func ListConfigurations(configService *service.ConfigService, _ json.RawMessage) (*orisdk.ConfigurationsResult, error) {
	return configService.ListConfigurations()
}
