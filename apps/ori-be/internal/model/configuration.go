package model

import (
	"path/filepath"

	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/cloneutil"
	dto "github.com/crueladdict/ori/libs/contract/go"
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
		var password *dto.PasswordConfig
		if cfg.Password != nil {
			password = &dto.PasswordConfig{
				Type: dto.PasswordConfigType(cfg.Password.Type),
				Key:  cfg.Password.Key,
			}
		}

		var tls *dto.TlsConfig
		if cfg.TLS != nil {
			tls = &dto.TlsConfig{
				Mode:       cloneutil.Ptr(cfg.TLS.Mode),
				CaCertPath: cloneutil.Ptr(cfg.TLS.CACertPath),
				CertPath:   cloneutil.Ptr(cfg.TLS.CertPath),
				KeyPath:    cloneutil.Ptr(cfg.TLS.KeyPath),
			}
		}

		dtoConfigs[i] = dto.Configuration{
			Name:     cfg.Name,
			Type:     cfg.Type,
			Database: cfg.Database,
			Host:     cloneutil.Ptr(cfg.Host),
			Port:     cloneutil.Ptr(cfg.Port),
			Username: cloneutil.Ptr(cfg.Username),
			Password: password,
			Tls:      tls,
		}
	}
	return &dto.ConfigurationsResponse{Connections: dtoConfigs}
}

func ResolveTLSPaths(tls *TLSConfig, baseDir string) *TLSConfig {
	if tls == nil {
		return nil
	}

	return &TLSConfig{
		Mode:       cloneutil.Ptr(tls.Mode),
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
		return cloneutil.Ptr(value)
	}

	resolved := filepath.Clean(filepath.Join(baseDir, *value))
	return &resolved
}
