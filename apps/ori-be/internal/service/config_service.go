package service

import (
	"fmt"
	"path/filepath"
	"sync"

	orisdk "github.com/crueladdict/ori/libs/sdk/go"

	"github.com/crueladdict/ori/apps/ori-server/internal/infrastructure/storage"
	"github.com/crueladdict/ori/apps/ori-server/internal/model"
)

type ConfigService struct {
	loader *storage.ConfigLoader
	config *model.Config
	mu     sync.RWMutex
}

func NewConfigService(configPath string) *ConfigService {
	return &ConfigService{
		loader: storage.NewConfigLoader(configPath),
	}
}

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

func (cs *ConfigService) ReloadConfig() error {
	return cs.LoadConfig()
}

func (cs *ConfigService) ListConfigurations() (*orisdk.ConfigurationsResult, error) {
	cs.mu.RLock()
	defer cs.mu.RUnlock()

	if cs.config == nil {
		return nil, fmt.Errorf("configuration not loaded")
	}

	return cs.config.ToSDK(), nil
}

func (cs *ConfigService) ByName(name string) (*model.Configuration, error) {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	if cs.config == nil {
		return nil, fmt.Errorf("configuration not loaded")
	}
	for i := range cs.config.Configurations {
		if cs.config.Configurations[i].Name == name {
			return &cs.config.Configurations[i], nil
		}
	}
	return nil, fmt.Errorf("connection '%s' not found", name)
}

func (cs *ConfigService) ConfigBaseDir() string {
	return filepath.Dir(cs.loader.Path())
}
