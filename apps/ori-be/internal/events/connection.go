package events

const (
	// ConnectionStateEvent is emitted whenever a connection state changes.
	ConnectionStateEvent = "connection.state"
	// QueryJobCompletedEvent is emitted when a query job completes.
	QueryJobCompletedEvent = "query.job.completed"

	ConnectionStateConnecting = "connecting"
	ConnectionStateConnected  = "connected"
	ConnectionStateFailed     = "failed"
)

type ConnectionStatePayload struct {
	ConfigurationName string `json:"configurationName"`
	State             string `json:"state"`
	Message           string `json:"message,omitempty"`
	Error             string `json:"error,omitempty"`
}

type QueryJobCompletedPayload struct {
	JobID             string `json:"jobId"`
	ConfigurationName string `json:"configurationName"`
	Status            string `json:"status"`
	FinishedAt        string `json:"finishedAt"`
	DurationMs        int64  `json:"durationMs"`
	Error             string `json:"error,omitempty"`
	Message           string `json:"message,omitempty"`
	Stored            bool   `json:"stored"`
}
