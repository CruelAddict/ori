package events

import (
	"sync"
	"time"
)

// Event represents a typed notification that can be streamed to clients.
type Event struct {
	Name      string    `json:"name"`
	Timestamp time.Time `json:"timestamp"`
	Payload   any       `json:"payload"`
}

// Hub fan-outs events to subscribers using per-subscriber buffered channels.
type Hub struct {
	mu          sync.RWMutex
	subscribers map[uint64]chan Event
	nextID      uint64
	bufferSize  int
}

func NewHub() *Hub {
	return &Hub{
		subscribers: make(map[uint64]chan Event),
		bufferSize:  32,
	}
}

// Publish delivers the event to all subscribers. Slow subscribers will drop events
// to avoid blocking publishers.
func (h *Hub) Publish(evt Event) {
	evt.Timestamp = time.Now().UTC()

	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, ch := range h.subscribers {
		select {
		case ch <- evt:
		default:
			// Drop event for this subscriber to avoid backpressure.
		}
	}
}

// Subscribe registers a listener and returns a channel plus a cleanup function.
func (h *Hub) Subscribe() (<-chan Event, func()) {
	h.mu.Lock()
	defer h.mu.Unlock()
	id := h.nextID
	h.nextID++
	ch := make(chan Event, h.bufferSize)
	h.subscribers[id] = ch

	unsubscribe := func() {
		h.mu.Lock()
		if sub, ok := h.subscribers[id]; ok {
			delete(h.subscribers, id)
			close(sub)
		}
		h.mu.Unlock()
	}

	return ch, unsubscribe
}
