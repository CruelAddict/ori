package events

const (
	// ConnectionStateEvent is the SSE event name emitted whenever a connection state changes.
	ConnectionStateEvent = "connection.state"

	ConnectionStateConnecting = "connecting"
	ConnectionStateConnected  = "connected"
	ConnectionStateFailed     = "failed"
)

// ConnectionStatePayload carries connection lifecycle updates.
type ConnectionStatePayload struct {
	ConfigurationName string `json:"configurationName"`
	State             string `json:"state"`
	Message           string `json:"message,omitempty"`
	Error             string `json:"error,omitempty"`
}
