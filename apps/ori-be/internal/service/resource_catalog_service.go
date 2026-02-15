package service

import (
	"fmt"
	"path/filepath"
	"sync"

	"github.com/crueladdict/ori/apps/ori-server/internal/infrastructure/storage"
	"github.com/crueladdict/ori/apps/ori-server/internal/model"
)

type ResourceCatalogService struct {
	loader *storage.ResourceLoader
	config *model.Config
	mu     sync.RWMutex
}

func NewResourceCatalogService(resourcesPath string) *ResourceCatalogService {
	return &ResourceCatalogService{
		loader: storage.NewResourceLoader(resourcesPath),
	}
}

func (cs *ResourceCatalogService) LoadResources() error {
	config, err := cs.loader.Load()
	if err != nil {
		return fmt.Errorf("failed to load resource: %w", err)
	}

	cs.mu.Lock()
	cs.config = config
	cs.mu.Unlock()

	return nil
}

func (cs *ResourceCatalogService) ReloadResources() error {
	return cs.LoadResources()
}

func (cs *ResourceCatalogService) ListResources() ([]model.Resource, error) {
	cs.mu.RLock()
	defer cs.mu.RUnlock()

	if cs.config == nil {
		return nil, fmt.Errorf("resource not loaded")
	}

	configs := make([]model.Resource, len(cs.config.Resources))
	// Return a detached top-level slice to avoid exposing internal storage.
	copy(configs, cs.config.Resources)

	return configs, nil
}

func (cs *ResourceCatalogService) ByName(name string) (*model.Resource, error) {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	if cs.config == nil {
		return nil, fmt.Errorf("resource not loaded")
	}
	for i := range cs.config.Resources {
		if cs.config.Resources[i].Name == name {
			return &cs.config.Resources[i], nil
		}
	}
	return nil, fmt.Errorf("resource '%s' not found", name)
}

func (cs *ResourceCatalogService) ResourcesBaseDir() string {
	return filepath.Dir(cs.loader.Path())
}
