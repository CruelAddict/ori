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

// ConnectResult mirrors the RPC ConnectResult schema
// Result: success | fail | connecting
// UserMessage: optional text for the user
type ConnectResult struct {
	Result      string  `json:"result"`
	UserMessage *string `json:"userMessage,omitempty"`
}

// NodeEdge lists related node IDs for a specific edge kind.
type NodeEdge struct {
	Items     []string `json:"items"`
	Truncated bool     `json:"truncated"`
}

// Node mirrors the server-side graph node DTO.
type Node struct {
	ID         string              `json:"id"`
	Type       string              `json:"type"`
	Name       string              `json:"name"`
	Attributes map[string]any      `json:"attributes"`
	Edges      map[string]NodeEdge `json:"edges"`
}

// GetNodesParams describes the getNodes request payload.
type GetNodesParams struct {
	ConfigurationName string   `json:"configurationName"`
	NodeIDs           []string `json:"nodeIDs,omitempty"`
}

// GetNodesResult wraps the list of returned nodes.
type GetNodesResult struct {
	Nodes []Node `json:"nodes"`
}

// QueryExecParams represents the parameters for query.exec method
type QueryExecParams struct {
	ConfigurationName string            `json:"configurationName"`
	Query             string            `json:"query"`
	Params            interface{}       `json:"params,omitempty"` // Can be map[string]interface{} or []interface{}
	Options           *QueryExecOptions `json:"options,omitempty"`
}

// QueryExecOptions represents execution options for database queries
type QueryExecOptions struct {
	MaxRows int `json:"maxRows,omitempty"`
}

// QueryExecResult represents the immediate result of query.exec method
type QueryExecResult struct {
	JobID   string `json:"jobId"`
	Status  string `json:"status"` // "running" or "failed"
	Message string `json:"message,omitempty"`
}

// QueryResultColumn represents column metadata in query results
type QueryResultColumn struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// QueryGetResultParams represents the parameters for query.getResult method
type QueryGetResultParams struct {
	JobID  string `json:"jobId"`
	Limit  *int   `json:"limit,omitempty"`
	Offset *int   `json:"offset,omitempty"`
}

// QueryGetResultResult represents the result of query.getResult method
type QueryGetResultResult struct {
	Columns   []QueryResultColumn `json:"columns"`
	Rows      [][]any             `json:"rows"`
	RowCount  int                 `json:"row_count"`
	Truncated bool                `json:"truncated"`
}
