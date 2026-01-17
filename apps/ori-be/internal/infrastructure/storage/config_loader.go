package storage

import (
	"fmt"
	"log/slog"
	"os"

	"gopkg.in/yaml.v3"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
)

type ConfigLoader struct {
	configPath string
}

func NewConfigLoader(configPath string) *ConfigLoader {
	return &ConfigLoader{
		configPath: configPath,
	}
}

// Path returns the configuration file path
func (cl *ConfigLoader) Path() string { return cl.configPath }

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
	if len(config.Configurations) == 0 {
		return nil
	}

	for i, conn := range config.Configurations {
		if conn.Name == "" {
			return fmt.Errorf("connection at index %d: name is required", i)
		}
		if conn.Type == "" {
			return fmt.Errorf("connection '%s': type is required", conn.Name)
		}
		if conn.Database == "" {
			return fmt.Errorf("connection '%s': database is required", conn.Name)
		}

		// Driver-specific validation
		switch conn.Type {
		case "sqlite":
			// For sqlite, database is a file path; other fields optional
			if conn.TLS != nil {
				slog.Warn("tls settings ignored for sqlite connection", slog.String("connection", conn.Name))
			}
		default:
			if conn.Host == nil || *conn.Host == "" {
				return fmt.Errorf("connection '%s': host is required", conn.Name)
			}
			if conn.Port == nil || *conn.Port <= 0 {
				return fmt.Errorf("connection '%s': port must be positive", conn.Name)
			}
			if conn.Username == nil || *conn.Username == "" {
				return fmt.Errorf("connection '%s': username is required", conn.Name)
			}
			if err := cl.validatePassword(conn.Name, conn.Password); err != nil {
				return err
			}
		}
	}

	return nil
}

func (cl *ConfigLoader) validatePassword(connName string, cfg *model.PasswordConfig) error {
	if cfg == nil {
		return nil
	}
	if cfg.Type == "" {
		return fmt.Errorf("connection '%s': password.type is required", connName)
	}

	switch cfg.Type {
	case "plain_text", "shell", "keychain":
		if cfg.Key == "" {
			return fmt.Errorf("connection '%s': password.key is required", connName)
		}
	default:
		return fmt.Errorf("connection '%s': password.type '%s' is not supported", connName, cfg.Type)
	}

	return nil
}
