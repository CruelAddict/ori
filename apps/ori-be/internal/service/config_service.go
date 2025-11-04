package service

import (
	"fmt"
	"sync"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
	"github.com/crueladdict/ori/apps/ori-server/internal/storage"
	orisdk "github.com/crueladdict/ori/libs/sdk/go"
)

// ConfigService handles business logic for configuration management
type ConfigService struct {
	loader *storage.ConfigLoader
	config *model.Config
	mu     sync.RWMutex
}

// NewConfigService creates a new ConfigService
func NewConfigService(configPath string) *ConfigService {
	return &ConfigService{
		loader: storage.NewConfigLoader(configPath),
	}
}

// LoadConfig loads the configuration from file and caches it
func (cs *ConfigService) LoadConfig() error {
	config, err := cs.loader.Load()
	if err != nil {
		return fmt.Errorf("failed to load configuration: %w", err)
	}

	cs.mu.Lock()
	cs.config = config
	cs.mu.Unlock()

	return nil
}

// ReloadConfig reloads the configuration from file
// This method is provided for future use when dynamic config reloading is needed
func (cs *ConfigService) ReloadConfig() error {
	return cs.LoadConfig()
}

// ListConfigurations returns all configured database connections from cached config
func (cs *ConfigService) ListConfigurations() (*orisdk.ConfigurationsResult, error) {
	cs.mu.RLock()
	defer cs.mu.RUnlock()

	if cs.config == nil {
		return nil, fmt.Errorf("configuration not loaded")
	}

	// Convert to SDK types
	return cs.config.ToSDK(), nil
}
