package orisdk

// PasswordConfig represents password retrieval configuration
type PasswordConfig struct {
	Type string `json:"type"`
	Key  string `json:"key"`
}

// ConnectionConfig represents a database connection configuration
type ConnectionConfig struct {
	Name     string         `json:"name"`
	Type     string         `json:"type"`
	Host     string         `json:"host"`
	Port     int            `json:"port"`
	Database string         `json:"database"`
	Username string         `json:"username"`
	Password PasswordConfig `json:"password"`
}

// ConfigurationsResult represents the result of listConfigurations method
type ConfigurationsResult struct {
	Connections []ConnectionConfig `json:"connections"`
}
