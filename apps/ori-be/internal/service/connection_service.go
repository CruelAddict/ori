package service

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/crueladdict/ori/apps/ori-server/internal/events"
	"github.com/crueladdict/ori/apps/ori-server/internal/model"
)

type ConnectOutcome struct {
	Result      string
	UserMessage string
}

const (
	ConnectResultSuccess    = "success"
	ConnectResultFail       = "fail"
	ConnectResultConnecting = "connecting"
)

const connectAttemptTimeout = 30 * time.Second

// ConnectionHandle represents an established connection backed by a concrete adapter instance.
type ConnectionHandle struct {
	Name          string
	Configuration *model.Configuration
	Adapter       ConnectionAdapter
	connectedAt   time.Time
}

// Close releases resources held by the handle's adapter.
func (h *ConnectionHandle) Close() error {
	if h == nil || h.Adapter == nil {
		return nil
	}
	return h.Adapter.Close()
}

// Ping delegates to the underlying adapter to verify connection health.
func (h *ConnectionHandle) Ping(ctx context.Context) error {
	if h == nil || h.Adapter == nil {
		return fmt.Errorf("connection handle missing adapter")
	}
	return h.Adapter.Ping(ctx)
}

type ConnectionService struct {
	configs *ConfigService
	events  *events.Hub

	connMu      sync.RWMutex
	connections map[string]*ConnectionHandle

	factoryMu sync.RWMutex
	factories map[string]ConnectionAdapterFactory
}

func NewConnectionService(configService *ConfigService, eventHub *events.Hub) *ConnectionService {
	return &ConnectionService{
		configs:     configService,
		events:      eventHub,
		connections: make(map[string]*ConnectionHandle),
		factories:   make(map[string]ConnectionAdapterFactory),
	}
}

// RegisterAdapter binds a database type to an adapter factory.
func (cs *ConnectionService) RegisterAdapter(dbType string, factory ConnectionAdapterFactory) {
	if factory == nil {
		return
	}
	normalized := strings.ToLower(strings.TrimSpace(dbType))
	if normalized == "" {
		return
	}
	cs.factoryMu.Lock()
	cs.factories[normalized] = factory
	cs.factoryMu.Unlock()
}

func (cs *ConnectionService) Connect(ctx context.Context, name string) ConnectOutcome {
	handle, ok := cs.GetConnection(name)
	if ok && handle != nil {
		pingCtx, cancel := context.WithTimeout(ctx, 250*time.Millisecond)
		defer cancel()
		if err := handle.Ping(pingCtx); err == nil {
			cs.emitConnectionEvent(name, events.ConnectionStateConnected, fmt.Sprintf("connection '%s' ready", name), nil)
			return ConnectOutcome{Result: ConnectResultSuccess}
		}
		slog.Info("connection ping failed; reopening", slog.String("configuration", name))
		cs.removeConnection(name)
	}

	message := fmt.Sprintf("connecting to '%s'", name)
	cs.emitConnectionEvent(name, events.ConnectionStateConnecting, message, nil)
	go cs.openInBackground(name)
	return ConnectOutcome{Result: ConnectResultConnecting, UserMessage: message}
}

func (cs *ConnectionService) openInBackground(name string) {
	ctx, cancel := context.WithTimeout(context.Background(), connectAttemptTimeout)
	defer cancel()

	cfg, err := cs.configs.ByName(name)
	if err != nil {
		cs.emitConnectionEvent(name, events.ConnectionStateFailed, "", err)
		slog.Error("database connect failed", slog.String("configuration", name), slog.Any("err", err))
		return
	}

	factory, ok := cs.adapterFactory(cfg.Type)
	if !ok {
		openErr := fmt.Errorf("unsupported database type: %s", cfg.Type)
		cs.emitConnectionEvent(name, events.ConnectionStateFailed, "", openErr)
		slog.Error("database connect failed", slog.String("configuration", name), slog.Any("err", openErr))
		return
	}

	params := AdapterFactoryParams{
		ConnectionName: name,
		Configuration:  cfg,
		BaseDir:        cs.configs.ConfigBaseDir(),
	}

	adapter, err := factory(params)
	if err != nil {
		cs.emitConnectionEvent(name, events.ConnectionStateFailed, "", err)
		slog.Error("database connect failed", slog.String("configuration", name), slog.Any("err", err))
		return
	}

	if err := adapter.Connect(ctx); err != nil {
		_ = adapter.Close()
		cs.emitConnectionEvent(name, events.ConnectionStateFailed, "", err)
		slog.Error("database connect failed", slog.String("configuration", name), slog.Any("err", err))
		return
	}

	if err := adapter.Ping(ctx); err != nil {
		_ = adapter.Close()
		cs.emitConnectionEvent(name, events.ConnectionStateFailed, "", err)
		slog.Error("database ping failed", slog.String("configuration", name), slog.Any("err", err))
		return
	}

	handle := &ConnectionHandle{
		Name:          name,
		Configuration: cfg,
		Adapter:       adapter,
		connectedAt:   time.Now(),
	}

	var previous *ConnectionHandle
	cs.connMu.Lock()
	previous = cs.connections[name]
	cs.connections[name] = handle
	cs.connMu.Unlock()

	if previous != nil {
		if err := previous.Close(); err != nil {
			slog.Warn("failed to close previous connection adapter", slog.String("configuration", name), slog.Any("err", err))
		}
	}

	slog.Info("database connected", slog.String("configuration", name), slog.String("driver", cfg.Type))
	cs.emitConnectionEvent(name, events.ConnectionStateConnected, fmt.Sprintf("connected to '%s'", name), nil)
}

func (cs *ConnectionService) removeConnection(name string) {
	cs.connMu.Lock()
	handle := cs.connections[name]
	delete(cs.connections, name)
	cs.connMu.Unlock()

	if handle != nil {
		if err := handle.Close(); err != nil {
			slog.Warn("failed to close connection adapter", slog.String("configuration", name), slog.Any("err", err))
		}
	}
}

func (cs *ConnectionService) emitConnectionEvent(name, state, message string, err error) {
	if cs.events == nil {
		return
	}

	payload := events.ConnectionStatePayload{
		ConfigurationName: name,
		State:             state,
	}
	if message != "" {
		payload.Message = message
	}
	if err != nil {
		payload.Error = err.Error()
		if payload.Message == "" {
			payload.Message = payload.Error
		}
	}

	cs.events.Publish(events.Event{Name: events.ConnectionStateEvent, Payload: payload})
}

func (cs *ConnectionService) GetConnection(name string) (*ConnectionHandle, bool) {
	cs.connMu.RLock()
	defer cs.connMu.RUnlock()
	handle, ok := cs.connections[name]
	return handle, ok
}

func (cs *ConnectionService) adapterFactory(dbType string) (ConnectionAdapterFactory, bool) {
	normalized := strings.ToLower(strings.TrimSpace(dbType))
	cs.factoryMu.RLock()
	factory, ok := cs.factories[normalized]
	cs.factoryMu.RUnlock()
	return factory, ok
}
