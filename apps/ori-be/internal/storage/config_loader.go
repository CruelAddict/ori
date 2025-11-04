package storage

import (
	"fmt"
	"os"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"

	"gopkg.in/yaml.v3"
)

// ConfigLoader handles loading configuration from YAML files
type ConfigLoader struct {
	configPath string
}

// NewConfigLoader creates a new ConfigLoader
func NewConfigLoader(configPath string) *ConfigLoader {
	return &ConfigLoader{
		configPath: configPath,
	}
}

// Load reads and parses the YAML configuration file
func (cl *ConfigLoader) Load() (*model.Config, error) {
	data, err := os.ReadFile(cl.configPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	var config model.Config
	if err := yaml.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("failed to parse config file: %w", err)
	}

	// Validate configuration
	if err := cl.validate(&config); err != nil {
		return nil, fmt.Errorf("invalid configuration: %w", err)
	}

	return &config, nil
}

// validate checks the configuration for required fields
func (cl *ConfigLoader) validate(config *model.Config) error {
	// Empty connections list is valid
	if len(config.Connections) == 0 {
		return nil
	}

	for i, conn := range config.Connections {
		if conn.Name == "" {
			return fmt.Errorf("connection at index %d: name is required", i)
		}
		if conn.Type == "" {
			return fmt.Errorf("connection '%s': type is required", conn.Name)
		}
		if conn.Host == "" {
			return fmt.Errorf("connection '%s': host is required", conn.Name)
		}
		if conn.Port <= 0 {
			return fmt.Errorf("connection '%s': port must be positive", conn.Name)
		}
		if conn.Database == "" {
			return fmt.Errorf("connection '%s': database is required", conn.Name)
		}
		if conn.Username == "" {
			return fmt.Errorf("connection '%s': username is required", conn.Name)
		}
		if conn.Password.Type == "" {
			return fmt.Errorf("connection '%s': password.type is required", conn.Name)
		}
		if conn.Password.Key == "" {
			return fmt.Errorf("connection '%s': password.key is required", conn.Name)
		}
	}

	return nil
}
