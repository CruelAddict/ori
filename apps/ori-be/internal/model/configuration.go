package model

import dto "github.com/crueladdict/ori/libs/contract/go"

type PasswordConfig struct {
	Type string `yaml:"type"` // Password provider type (plain_text, macos-keychain, etc.)
	Key  string `yaml:"key"`  // The key/value for password retrieval
}

type Configuration struct {
	Name     string          `yaml:"name"`
	Type     string          `yaml:"type"`
	Host     *string         `yaml:"host,omitempty"`
	Port     *int            `yaml:"port,omitempty"`
	Database string          `yaml:"database"`
	Username *string         `yaml:"username,omitempty"`
	Password *PasswordConfig `yaml:"password,omitempty"`
}

type Config struct {
	Configurations []Configuration `yaml:"connections"`
}

func (c *Config) ConvertToDTO() *dto.ConfigurationsResponse {
	if c == nil {
		return nil
	}
	return ConvertConfigurationsToDTO(c.Configurations)
}

func ConvertConfigurationsToDTO(configs []Configuration) *dto.ConfigurationsResponse {
	dtoConfigs := make([]dto.Configuration, len(configs))
	for i, cfg := range configs {
		dtoConfigs[i] = dto.Configuration{
			Name:     cfg.Name,
			Type:     cfg.Type,
			Database: cfg.Database,
			Host:     cloneString(cfg.Host),
			Port:     cloneInt(cfg.Port),
			Username: cloneString(cfg.Username),
			Password: clonePassword(cfg.Password),
		}
	}
	return &dto.ConfigurationsResponse{Connections: dtoConfigs}
}

// cloneString duplicates the pointer so DTOs receive independent values.
func cloneString(src *string) *string {
	if src == nil {
		return nil
	}
	copy := *src
	return &copy
}

// cloneInt duplicates the pointer so DTOs receive independent values.
func cloneInt(src *int) *int {
	if src == nil {
		return nil
	}
	copy := *src
	return &copy
}

// clonePassword converts the model password into a DTO-friendly struct.
func clonePassword(src *PasswordConfig) *dto.PasswordConfig {
	if src == nil {
		return nil
	}
	return &dto.PasswordConfig{Type: src.Type, Key: src.Key}
}
