package storage

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
)

type ResourceLoader struct {
	resourcesPath string
}

func NewResourceLoader(resourcesPath string) *ResourceLoader {
	return &ResourceLoader{
		resourcesPath: resourcesPath,
	}
}

// Path returns the resource file path
func (cl *ResourceLoader) Path() string { return cl.resourcesPath }

// Load reads and parses the JSON resource file
func (cl *ResourceLoader) Load() (*model.Config, error) {
	data, err := os.ReadFile(cl.resourcesPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	var config model.Config
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("failed to parse config file: %w", err)
	}

	// Validate resource
	if err := cl.validate(&config); err != nil {
		return nil, fmt.Errorf("invalid resource: %w", err)
	}

	return &config, nil
}

// validate checks the resource for required fields
func (cl *ResourceLoader) validate(config *model.Config) error {
	// Empty resource list is valid.
	if len(config.Resources) == 0 {
		return nil
	}

	for i, conn := range config.Resources {
		if conn.Name == "" {
			return fmt.Errorf("resource at index %d: name is required", i)
		}
		if conn.Type == "" {
			return fmt.Errorf("resource '%s': type is required", conn.Name)
		}
		if conn.Database == "" {
			return fmt.Errorf("resource '%s': database is required", conn.Name)
		}

		// Driver-specific validation
		switch conn.Type {
		case "sqlite":
			// For sqlite, database is a file path; other fields optional
			if conn.TLS != nil {
				slog.Warn("tls settings ignored for sqlite resource", slog.String("resource", conn.Name))
			}
		default:
			if conn.Host == nil || *conn.Host == "" {
				return fmt.Errorf("resource '%s': host is required", conn.Name)
			}
			if conn.Port == nil || *conn.Port <= 0 {
				return fmt.Errorf("resource '%s': port must be positive", conn.Name)
			}
			if conn.Username == nil || *conn.Username == "" {
				return fmt.Errorf("resource '%s': username is required", conn.Name)
			}
			if err := cl.validatePassword(conn.Name, conn.Password); err != nil {
				return err
			}
		}
	}

	return nil
}

func (cl *ResourceLoader) validatePassword(connName string, cfg *model.PasswordConfig) error {
	if cfg == nil {
		return nil
	}
	if cfg.Type == "" {
		return fmt.Errorf("resource '%s': password.type is required", connName)
	}

	switch cfg.Type {
	case "plain_text", "shell", "keychain":
		if cfg.Key == "" {
			return fmt.Errorf("resource '%s': password.key is required", connName)
		}
	default:
		return fmt.Errorf("resource '%s': password.type '%s' is not supported", connName, cfg.Type)
	}

	return nil
}
