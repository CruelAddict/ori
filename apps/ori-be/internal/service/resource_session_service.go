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

type ResourceConnectOutcome struct {
	Result      string
	UserMessage string
}

const (
	ResourceConnectResultSuccess    = "success"
	ResourceConnectResultFail       = "fail"
	ResourceConnectResultConnecting = "connecting"
)

const connectAttemptTimeout = 30 * time.Second

// ResourceHandle represents an established connection backed by a concrete adapter instance.
type ResourceHandle struct {
	Name        string
	Resource    *model.Resource
	Adapter     ConnectionAdapter
	connectedAt time.Time
}

// Close releases resources held by the handle's adapter.
func (h *ResourceHandle) Close() error {
	if h == nil || h.Adapter == nil {
		return nil
	}
	return h.Adapter.Close()
}

// Ping delegates to the underlying adapter to verify connection health.
func (h *ResourceHandle) Ping(ctx context.Context) error {
	if h == nil || h.Adapter == nil {
		return fmt.Errorf("resource handle missing adapter")
	}
	return h.Adapter.Ping(ctx)
}

type ResourceSessionService struct {
	configs *ResourceCatalogService
	events  *events.Hub

	connMu      sync.RWMutex
	connections map[string]*ResourceHandle

	factoryMu sync.RWMutex
	factories map[string]ConnectionAdapterFactory
}

func NewResourceSessionService(configService *ResourceCatalogService, eventHub *events.Hub) *ResourceSessionService {
	return &ResourceSessionService{
		configs:     configService,
		events:      eventHub,
		connections: make(map[string]*ResourceHandle),
		factories:   make(map[string]ConnectionAdapterFactory),
	}
}

// RegisterAdapter binds a database type to an adapter factory.
func (cs *ResourceSessionService) RegisterAdapter(dbType string, factory ConnectionAdapterFactory) {
	if factory == nil {
		return
	}
	normalized := strings.ToLower(strings.TrimSpace(dbType))
	cs.factoryMu.Lock()
	cs.factories[normalized] = factory
	cs.factoryMu.Unlock()
}

func (cs *ResourceSessionService) Connect(ctx context.Context, name string) ResourceConnectOutcome {
	handle, ok := cs.GetConnection(name)
	if ok && handle != nil {
		// TODO: move inside ping
		pingCtx, cancel := context.WithTimeout(ctx, 250*time.Millisecond)
		defer cancel()
		if err := handle.Ping(pingCtx); err == nil {
			cs.emitConnectionEvent(name, events.ConnectionStateConnected, fmt.Sprintf("connection for resource '%s' is ready", name), nil)
			return ResourceConnectOutcome{Result: ResourceConnectResultSuccess}
		}
		slog.InfoContext(ctx, "connection ping failed; reopening", slog.String("resource", name))
		cs.removeConnection(name)
	}

	message := fmt.Sprintf("opening connection to resource '%s'", name)
	cs.emitConnectionEvent(name, events.ConnectionStateConnecting, message, nil)
	go cs.openInBackground(name)
	return ResourceConnectOutcome{Result: ResourceConnectResultConnecting, UserMessage: message}
}

func (cs *ResourceSessionService) openInBackground(name string) {
	ctx, cancel := context.WithTimeout(context.Background(), connectAttemptTimeout)
	defer cancel()

	cfg, err := cs.configs.ByName(name)
	if err != nil {
		cs.emitConnectionEvent(name, events.ConnectionStateFailed, "", err)
		slog.ErrorContext(ctx, "database connect failed", slog.String("resource", name), slog.Any("err", err))
		return
	}

	// TODO: get rid of this OOP slop
	factory, ok := cs.adapterFactory(cfg.Type)
	if !ok {
		openErr := fmt.Errorf("unsupported database type: %s", cfg.Type)
		cs.emitConnectionEvent(name, events.ConnectionStateFailed, "", openErr)
		slog.ErrorContext(ctx, "database connect failed", slog.String("resource", name), slog.Any("err", openErr))
		return
	}

	params := AdapterFactoryParams{
		ConnectionName: name,
		Resource:       cfg,
		BaseDir:        cs.configs.ResourcesBaseDir(),
	}

	adapter, err := factory(params)
	if err != nil {
		cs.emitConnectionEvent(name, events.ConnectionStateFailed, "", err)
		slog.ErrorContext(ctx, "database connect failed", slog.String("resource", name), slog.Any("err", err))
		return
	}

	if err := adapter.Connect(ctx); err != nil {
		_ = adapter.Close()
		cs.emitConnectionEvent(name, events.ConnectionStateFailed, "", err)
		slog.ErrorContext(ctx, "database connect failed", slog.String("resource", name), slog.Any("err", err))
		return
	}

	if err := adapter.Ping(ctx); err != nil {
		_ = adapter.Close()
		cs.emitConnectionEvent(name, events.ConnectionStateFailed, "", err)
		slog.ErrorContext(ctx, "database ping failed", slog.String("resource", name), slog.Any("err", err))
		return
	}

	handle := &ResourceHandle{
		Name:        name,
		Resource:    cfg,
		Adapter:     adapter,
		connectedAt: time.Now(),
	}

	var previous *ResourceHandle
	cs.connMu.Lock()
	previous = cs.connections[name]
	cs.connections[name] = handle
	cs.connMu.Unlock()

	if previous != nil {
		if err := previous.Close(); err != nil {
			slog.WarnContext(ctx, "failed to close previous connection adapter", slog.String("resource", name), slog.Any("err", err))
		}
	}

	slog.InfoContext(ctx, "database connected", slog.String("resource", name), slog.String("driver", cfg.Type))
	cs.emitConnectionEvent(name, events.ConnectionStateConnected, fmt.Sprintf("connected to '%s'", name), nil)
}

func (cs *ResourceSessionService) removeConnection(name string) {
	cs.connMu.Lock()
	handle := cs.connections[name]
	delete(cs.connections, name)
	cs.connMu.Unlock()

	if handle != nil {
		if err := handle.Close(); err != nil {
			slog.Warn("failed to close connection adapter", slog.String("resource", name), slog.Any("err", err))
		}
	}
}

func (cs *ResourceSessionService) emitConnectionEvent(name, state, message string, err error) {
	if cs.events == nil {
		return
	}

	payload := events.ConnectionStatePayload{
		ResourceName: name,
		State:        state,
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

func (cs *ResourceSessionService) GetConnection(name string) (*ResourceHandle, bool) {
	cs.connMu.RLock()
	defer cs.connMu.RUnlock()
	handle, ok := cs.connections[name]
	return handle, ok
}

func (cs *ResourceSessionService) adapterFactory(dbType string) (ConnectionAdapterFactory, bool) {
	normalized := strings.ToLower(strings.TrimSpace(dbType))
	cs.factoryMu.RLock()
	factory, ok := cs.factories[normalized]
	cs.factoryMu.RUnlock()
	return factory, ok
}

// TODO: always use log with context
