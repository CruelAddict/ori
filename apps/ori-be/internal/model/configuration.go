package model

import orisdk "github.com/crueladdict/ori/libs/sdk/go"

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

func (c *Config) ToSDK() *orisdk.ConfigurationsResult {
	configurations := make([]orisdk.ConnectionConfig, len(c.Configurations))
	for i, conn := range c.Configurations {
		var host string
		if conn.Host != nil {
			host = *conn.Host
		}
		var port int
		if conn.Port != nil {
			port = *conn.Port
		}
		var username string
		if conn.Username != nil {
			username = *conn.Username
		}
		var pwd orisdk.PasswordConfig
		if conn.Password != nil {
			pwd = orisdk.PasswordConfig{Type: conn.Password.Type, Key: conn.Password.Key}
		}
		configurations[i] = orisdk.ConnectionConfig{
			Name:     conn.Name,
			Type:     conn.Type,
			Host:     host,
			Port:     port,
			Database: conn.Database,
			Username: username,
			Password: pwd,
		}
	}
	return &orisdk.ConfigurationsResult{Connections: configurations}
}
