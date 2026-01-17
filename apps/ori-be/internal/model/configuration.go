package model

import (
	dto "github.com/crueladdict/ori/libs/contract/go"
	"path/filepath"
)

type PasswordConfig struct {
	Type string `yaml:"type"`          // Password provider type (plain_text, shell, keychain)
	Key  string `yaml:"key,omitempty"` // Provider-specific value (plain text, shell command, or keychain account)
}

type TLSConfig struct {
	Mode       *string `yaml:"mode,omitempty"`
	CACertPath *string `yaml:"caCertPath,omitempty"`
	CertPath   *string `yaml:"certPath,omitempty"`
	KeyPath    *string `yaml:"keyPath,omitempty"`
}

type Configuration struct {
	Name     string          `yaml:"name"`
	Type     string          `yaml:"type"`
	Host     *string         `yaml:"host,omitempty"`
	Port     *int            `yaml:"port,omitempty"`
	Database string          `yaml:"database"`
	Username *string         `yaml:"username,omitempty"`
	Password *PasswordConfig `yaml:"password,omitempty"`
	TLS      *TLSConfig      `yaml:"tls,omitempty"`
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
			Tls:      cloneTLS(cfg.TLS),
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

	return &dto.PasswordConfig{
		Type: dto.PasswordConfigType(src.Type),
		Key:  src.Key,
	}
}

func cloneTLS(src *TLSConfig) *dto.TlsConfig {
	if src == nil {
		return nil
	}

	return &dto.TlsConfig{
		Mode:       cloneString(src.Mode),
		CACertPath: cloneString(src.CACertPath),
		CertPath:   cloneString(src.CertPath),
		KeyPath:    cloneString(src.KeyPath),
	}
}

func ResolveTLSPaths(tls *TLSConfig, baseDir string) *TLSConfig {
	if tls == nil {
		return nil
	}

	return &TLSConfig{
		Mode:       cloneString(tls.Mode),
		CACertPath: resolveTLSPath(baseDir, tls.CACertPath),
		CertPath:   resolveTLSPath(baseDir, tls.CertPath),
		KeyPath:    resolveTLSPath(baseDir, tls.KeyPath),
	}
}

func resolveTLSPath(baseDir string, value *string) *string {
	if value == nil || *value == "" {
		return nil
	}

	if filepath.IsAbs(*value) {
		return cloneString(value)
	}

	resolved := filepath.Clean(filepath.Join(baseDir, *value))
	return &resolved
}
