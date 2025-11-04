package model

import orisdk "github.com/crueladdict/ori/libs/sdk/go"

// PasswordConfig represents the password retrieval configuration
type PasswordConfig struct {
	Type string `yaml:"type"` // Password provider type (plain_text, macos-keychain, etc.)
	Key  string `yaml:"key"`  // The key/value for password retrieval
}

// ConnectionConfig represents a database connection configuration
type ConnectionConfig struct {
	Name     string         `yaml:"name"`
	Type     string         `yaml:"type"`
	Host     string         `yaml:"host"`
	Port     int            `yaml:"port"`
	Database string         `yaml:"database"`
	Username string         `yaml:"username"`
	Password PasswordConfig `yaml:"password"`
}

// Config represents the root configuration structure (for loading YAML)
type Config struct {
	Connections []ConnectionConfig `yaml:"connections"`
}

// ToSDK converts internal Config to SDK ConfigurationsResult
func (c *Config) ToSDK() *orisdk.ConfigurationsResult {
	connections := make([]orisdk.ConnectionConfig, len(c.Connections))
	for i, conn := range c.Connections {
		connections[i] = orisdk.ConnectionConfig{
			Name:     conn.Name,
			Type:     conn.Type,
			Host:     conn.Host,
			Port:     conn.Port,
			Database: conn.Database,
			Username: conn.Username,
			Password: orisdk.PasswordConfig{
				Type: conn.Password.Type,
				Key:  conn.Password.Key,
			},
		}
	}
	return &orisdk.ConfigurationsResult{
		Connections: connections,
	}
}
